-- One-time cleanup of malformed sales created by an older client/sync shape.
-- These rows have no real sale identity or no required business fields.
-- The current client also filters them so they cannot return to the UI.

DO $$
DECLARE
  bad_ids text[];
BEGIN
  SELECT coalesce(array_agg(id), array[]::text[])
    INTO bad_ids
  FROM public.sales
  WHERE lower(trim(id)) IN ('', 'undefined', 'null')
     OR (
       coalesce(trim(user_id), '') = ''
       AND coalesce(trim(payment), '') = ''
       AND coalesce(trim(order_id), '') = ''
       AND coalesce(order_number, 0) = 0
       AND coalesce(total, 0) = 0
       AND NOT (coalesce(data, '{}'::jsonb) ? 'items')
     );

  IF coalesce(array_length(bad_ids, 1), 0) = 0 THEN
    RETURN;
  END IF;

  DELETE FROM public.history_records
   WHERE entity = 'sale' AND record_id = ANY(bad_ids);

  DELETE FROM public.audit_events
   WHERE record_type = 'sale' AND record_id = ANY(bad_ids);

  UPDATE public.backup_snapshots b
  SET payload = jsonb_set(
    jsonb_set(
      jsonb_set(
        coalesce(b.payload, '{}'::jsonb),
        '{sales}',
        coalesce((
          SELECT jsonb_agg(item)
          FROM jsonb_array_elements(coalesce(b.payload->'sales', '[]'::jsonb)) item
          WHERE NOT ((item->>'id') = ANY(bad_ids))
        ), '[]'::jsonb), true
      ),
      '{history}',
      coalesce((
        SELECT jsonb_agg(item)
        FROM jsonb_array_elements(coalesce(b.payload->'history', '[]'::jsonb)) item
        WHERE NOT (item->>'entity' = 'sale' AND (item->>'recordId') = ANY(bad_ids))
      ), '[]'::jsonb), true
    ),
    '{events}',
    coalesce((
      SELECT jsonb_agg(item)
      FROM jsonb_array_elements(coalesce(b.payload->'events', '[]'::jsonb)) item
      WHERE NOT (item->>'recordType' = 'sale' AND (item->>'recordId') = ANY(bad_ids))
    ), '[]'::jsonb), true
  )
  WHERE coalesce(b.payload, '{}'::jsonb) ? 'sales';

  UPDATE public.cash_closures c
  SET data = jsonb_set(
    coalesce(c.data, '{}'::jsonb),
    '{sales}',
    coalesce((
      SELECT jsonb_agg(item)
      FROM jsonb_array_elements(coalesce(c.data->'sales', '[]'::jsonb)) item
      WHERE NOT ((item->>'id') = ANY(bad_ids))
    ), '[]'::jsonb), true
  )
  WHERE coalesce(c.data, '{}'::jsonb) ? 'sales';

  DELETE FROM public.sales WHERE id = ANY(bad_ids);
END $$;


-- Prevent the exact legacy corruption from being inserted again.
ALTER TABLE public.sales
  DROP CONSTRAINT IF EXISTS sales_reject_undefined_identity;

ALTER TABLE public.sales
  ADD CONSTRAINT sales_reject_undefined_identity
  CHECK (
    lower(trim(id)) NOT IN ('', 'undefined', 'null')
    AND length(trim(payment)) > 0
  );
