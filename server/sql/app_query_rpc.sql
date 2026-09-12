-- Run in the Supabase SQL Editor (Smartrack can also apply this over HTTPS).
-- Lets the Smartrack API execute existing SQL over HTTPS (service_role only).
-- Lets the Smartrack API execute existing SQL over HTTPS (service_role only).

CREATE OR REPLACE FUNCTION public.app_query(query_text text, query_params jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET timezone TO 'Asia/Manila'
AS $fn$
DECLARE
  bound text;
  result_json text;
  n int;
  i int;
  val jsonb;
  literal text;
  elem jsonb;
  parts text[];
  affected int := 0;
BEGIN
  bound := regexp_replace(query_text, ';\s*$', '');
  n := COALESCE(jsonb_array_length(query_params), 0);

  IF n > 0 THEN
    FOR i IN REVERSE n..1 LOOP
      bound := replace(bound, '$' || i::text, chr(1) || 'P' || i::text || chr(1));
    END LOOP;

    FOR i IN REVERSE n..1 LOOP
      val := query_params -> (i - 1);
      IF val IS NULL OR val = 'null'::jsonb THEN
        literal := 'NULL';
      ELSIF jsonb_typeof(val) = 'number' OR jsonb_typeof(val) = 'boolean' THEN
        literal := val #>> '{}';
      ELSIF jsonb_typeof(val) = 'array' THEN
        parts := ARRAY[]::text[];
        FOR elem IN SELECT * FROM jsonb_array_elements(val)
        LOOP
          IF elem IS NULL OR elem = 'null'::jsonb THEN
            parts := parts || 'NULL';
          ELSIF jsonb_typeof(elem) = 'number' OR jsonb_typeof(elem) = 'boolean' THEN
            parts := parts || (elem #>> '{}');
          ELSE
            parts := parts || quote_literal(elem #>> '{}');
          END IF;
        END LOOP;
        literal := 'ARRAY[' || array_to_string(parts, ',') || ']';
      ELSIF jsonb_typeof(val) = 'object' AND val ? '__bytea' THEN
        literal := format('decode(%L, %L)', val ->> '__bytea', 'base64');
      ELSIF jsonb_typeof(val) = 'object' THEN
        literal := quote_literal(val::text) || '::jsonb';
      ELSE
        literal := quote_literal(val #>> '{}');
      END IF;
      bound := replace(bound, chr(1) || 'P' || i::text || chr(1), literal);
    END LOOP;
  END IF;

  IF bound ~* '^\s*(begin|commit|rollback)(\s|;|$)' THEN
    RETURN jsonb_build_object('result_json', '[]', 'result_count', 0);
  END IF;

  IF bound ~* '^\s*(select|with|values|show|table)(\s|\(|$)'
     OR bound ~* '(^|[^[:alnum:]_])returning([^[:alnum:]_]|$)' THEN
    EXECUTE 'WITH __app_query_result AS (' || bound || ')
             SELECT COALESCE(jsonb_agg(to_jsonb(q)), ''[]''::jsonb)::text FROM __app_query_result q'
      INTO result_json;
    RETURN jsonb_build_object(
      'result_json', COALESCE(result_json, '[]'),
      'result_count', COALESCE(jsonb_array_length(COALESCE(result_json, '[]')::jsonb), 0)
    );
  END IF;

  EXECUTE bound;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN jsonb_build_object('result_json', '[]', 'result_count', affected);
END;
$fn$;

REVOKE ALL ON FUNCTION public.app_query(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_query(text, jsonb) TO service_role;
