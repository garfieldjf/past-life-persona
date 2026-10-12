-- ============================================================
--  你的前世身份档案 · Supabase 数据库结构
-- ------------------------------------------------------------
--  用法：Supabase 控制台 → SQL Editor → 新建查询 → 整段粘贴 → Run
--  整段是可重复执行的，跑第二遍不会报错、也不会重复建表。
--
--  设计要点（为什么这么写）：
--   1. 表上开启 RLS 且【故意不建任何 anon 策略】，
--      匿名角色连一行都读不到，更不可能遍历整张表。
--   2. 所有读写都必须经过下面四个 security definer 函数，
--      每个函数都有入参校验和限流，前端拿到的 anon key 因此
--      就算被人抄走，也只能「写一份合法档案」，不能拖库。
--   3. 不存任何可定位到人的信息。浏览器指纹只存 sha256 哈希，
--      用途仅是同源去重，不可逆推。
-- ============================================================

create extension if not exists pgcrypto;


-- ============================================================
--  一、表
-- ============================================================

-- 一份「前世档案」= 一次测评结果
create table if not exists public.personas (
  id          uuid        primary key default gen_random_uuid(),
  short_id    text        not null unique default encode(gen_random_bytes(6), 'hex'),
  archetype   text        not null,                 -- 主原型 id，如 sushi
  secondary   text        not null,                 -- 灵魂副调原型 id
  similarity  numeric(5,2) not null,                -- 匹配度百分比
  sign        text        not null,                 -- 点睛题落款：改革者/守护者/觉悟者/情义者
  vec         int[]       not null,                 -- 五维坐标，长度 5，取值 0-100
  mixed       boolean     not null default false,   -- 是否判定为混合人格
  ua_hash     text,                                 -- sha256(UA)，仅用于限流去重
  created_at  timestamptz not null default now()
);

create index if not exists personas_created_idx on public.personas (created_at desc);
create index if not exists personas_arch_idx    on public.personas (archetype);
create index if not exists personas_ua_idx      on public.personas (ua_hash, created_at desc);

-- 「准 / 不准」反馈
create table if not exists public.feedback (
  id          uuid        primary key default gen_random_uuid(),
  archetype   text        not null,
  vote        text        not null check (vote in ('accurate', 'inaccurate')),
  ua_hash     text,
  created_at  timestamptz not null default now()
);

create index if not exists feedback_arch_idx on public.feedback (archetype);


-- ============================================================
--  二、锁死直接访问
-- ============================================================
alter table public.personas enable row level security;
alter table public.feedback enable row level security;

-- Supabase 默认会把 public 下所有表的全部权限授给 anon / authenticated。
-- 这里显式收回，让匿名角色只能通过下面的函数访问。
revoke all on table public.personas from anon, authenticated;
revoke all on table public.feedback from anon, authenticated;

-- 注意：这里【不创建】任何 create policy。
-- 没有策略 = 匿名角色对该表的任何直接操作都会被拒绝。
-- 这是有意的，不要「顺手补一个 select 策略」。


-- ============================================================
--  三、RPC：前端唯一可用的四个入口
-- ============================================================

-- ---------- 3.1 写入一份档案，返回短 ID ----------
create or replace function public.persona_create(
  p_archetype  text,
  p_secondary  text,
  p_similarity numeric,
  p_sign       text,
  p_vec        integer[],
  p_mixed      boolean,
  p_ua         text default ''
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash   text;
  v_short  text;
  v_recent integer;
begin
  -- ---- 入参校验：不接受任何不合规的数据进门 ----
  if p_archetype is null or length(p_archetype) > 32 then
    raise exception 'invalid archetype';
  end if;
  if p_secondary is null or length(p_secondary) > 32 then
    raise exception 'invalid secondary';
  end if;
  if p_similarity is null or p_similarity < 0 or p_similarity > 100 then
    raise exception 'invalid similarity';
  end if;
  if p_sign is null or length(p_sign) > 16 then
    raise exception 'invalid sign';
  end if;
  if coalesce(array_length(p_vec, 1), 0) <> 5 then
    raise exception 'invalid vec length';
  end if;
  if exists (select 1 from unnest(p_vec) as t(v) where v < 0 or v > 100) then
    raise exception 'invalid vec range';
  end if;

  v_hash := encode(digest(coalesce(p_ua, ''), 'sha256'), 'hex');

  -- ---- 限流：同一浏览器 3 秒内只能写一次 ----
  select count(*) into v_recent
    from public.personas
   where ua_hash = v_hash
     and created_at > now() - interval '3 seconds';

  if v_recent > 0 then
    raise exception 'rate_limited';
  end if;

  insert into public.personas (archetype, secondary, similarity, sign, vec, mixed, ua_hash)
  values (p_archetype, p_secondary, p_similarity, p_sign, p_vec, coalesce(p_mixed, false), v_hash)
  returning short_id into v_short;

  return v_short;
end;
$$;


-- ---------- 3.2 按短 ID 取一份档案 ----------
-- 只可能返回 0 或 1 行，因此无法用来翻页遍历整张表。
create or replace function public.persona_get(p_short text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select to_jsonb(t)
    from (
      select archetype, secondary, similarity, sign, vec, mixed, short_id
        from public.personas
       where short_id = p_short
       limit 1
    ) t;
$$;


-- ---------- 3.3 提交「准 / 不准」 ----------
create or replace function public.persona_feedback(
  p_short text,
  p_vote  text,
  p_ua    text default ''
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_arch text;
  v_hash text;
  v_seen integer;
begin
  if p_vote is null or p_vote not in ('accurate', 'inaccurate') then
    raise exception 'invalid vote';
  end if;

  select archetype into v_arch
    from public.personas
   where short_id = p_short
   limit 1;

  if v_arch is null then
    return false;                       -- 档案不存在（例如本地模式生成的）
  end if;

  v_hash := encode(digest(coalesce(p_ua, ''), 'sha256'), 'hex');

  -- 同一浏览器对同一原型 24 小时内只计一次
  select count(*) into v_seen
    from public.feedback
   where ua_hash = v_hash
     and archetype = v_arch
     and created_at > now() - interval '24 hours';

  if v_seen > 0 then
    return true;                        -- 已记过，返回成功但不重复计数
  end if;

  insert into public.feedback (archetype, vote, ua_hash)
  values (v_arch, p_vote, v_hash);

  return true;
end;
$$;


-- ---------- 3.4 聚合统计（只出汇总，不出明细） ----------
create or replace function public.persona_stats()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'total', (select count(*) from public.personas),
    'today', (select count(*) from public.personas
               where created_at >= date_trunc('day', now())),
    'by_archetype', (
      select coalesce(jsonb_object_agg(archetype, c), '{}'::jsonb)
        from (select archetype, count(*) as c
                from public.personas
               group by archetype) x
    ),
    'feedback', jsonb_build_object(
      'accurate',   (select count(*) from public.feedback where vote = 'accurate'),
      'inaccurate', (select count(*) from public.feedback where vote = 'inaccurate')
    )
  );
$$;


-- ============================================================
--  四、授权：只把上面四个函数开放给匿名访问
-- ============================================================
revoke all on function public.persona_create(text, text, numeric, text, integer[], boolean, text) from public;
revoke all on function public.persona_get(text) from public;
revoke all on function public.persona_feedback(text, text, text) from public;
revoke all on function public.persona_stats() from public;

grant execute on function public.persona_create(text, text, numeric, text, integer[], boolean, text) to anon, authenticated;
grant execute on function public.persona_get(text)                                        to anon, authenticated;
grant execute on function public.persona_feedback(text, text, text)                       to anon, authenticated;
grant execute on function public.persona_stats()                                          to anon, authenticated;


-- ============================================================
--  五、自检（跑完会返回一行，确认四个函数都在）
-- ============================================================
select proname as "已就绪的函数"
  from pg_proc
 where pronamespace = 'public'::regnamespace
   and proname in ('persona_create', 'persona_get', 'persona_feedback', 'persona_stats')
 order by proname;

-- ============================================================
--  常用运维查询（需要时手动跑）
-- ============================================================
-- 看原型分布，判断哪个原型需要微调坐标（占比长期 > 25% 就该调）：
--   select archetype, count(*) as n,
--          round(count(*) * 100.0 / sum(count(*)) over (), 1) as pct
--     from public.personas group by archetype order by n desc;
--
-- 看最近 7 天每天的量：
--   select date_trunc('day', created_at) as d, count(*)
--     from public.personas where created_at > now() - interval '7 days'
--    group by d order by d;
