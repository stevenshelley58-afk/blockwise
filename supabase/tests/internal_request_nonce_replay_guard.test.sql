begin;

select plan(10);

select has_table('private', 'blockwise_internal_request_nonces', 'nonce ledger is private');
select has_function(
  'public',
  'claim_blockwise_internal_request_nonce',
  array['text', 'text', 'timestamp with time zone'],
  'nonce claim RPC exists'
);
select function_returns(
  'public',
  'claim_blockwise_internal_request_nonce',
  array['text', 'text', 'timestamp with time zone'],
  'boolean',
  'nonce claim RPC returns boolean'
);
select function_privs_are(
  'public',
  'claim_blockwise_internal_request_nonce',
  array['text', 'text', 'timestamp with time zone'],
  'anon',
  array[]::text[],
  'anon cannot claim internal nonces'
);
select function_privs_are(
  'public',
  'claim_blockwise_internal_request_nonce',
  array['text', 'text', 'timestamp with time zone'],
  'authenticated',
  array[]::text[],
  'authenticated users cannot claim internal nonces'
);
select function_privs_are(
  'public',
  'claim_blockwise_internal_request_nonce',
  array['text', 'text', 'timestamp with time zone'],
  'service_role',
  array['EXECUTE'],
  'service role can claim internal nonces'
);

set local role service_role;
select ok(
  public.claim_blockwise_internal_request_nonce(
    'adstudio.templates',
    '0123456789abcdef0123456789abcdef',
    statement_timestamp() + interval '5 minutes'
  ),
  'first nonce claim succeeds'
);
select ok(
  not public.claim_blockwise_internal_request_nonce(
    'adstudio.templates',
    '0123456789abcdef0123456789abcdef',
    statement_timestamp() + interval '5 minutes'
  ),
  'duplicate nonce claim is rejected atomically'
);
reset role;

select is(
  (select count(*) from private.blockwise_internal_request_nonces),
  1::bigint,
  'duplicate claim leaves exactly one nonce row'
);
select throws_ok(
  $$select public.claim_blockwise_internal_request_nonce('adstudio.other', 'fedcba9876543210fedcba9876543210', statement_timestamp() + interval '5 minutes')$$,
  'P0001',
  'invalid_internal_request_nonce',
  'unexpected scopes fail closed'
);

select * from finish();
rollback;
