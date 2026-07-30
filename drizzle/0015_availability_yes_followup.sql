-- After confirm_availability answers "yes", create an internal consultant
-- follow-up task. Previously no routing rule matched availability_yes, so the
-- external success screen promised next steps that never appeared.
INSERT INTO routing_rules (
  tenant_id,
  name,
  trigger_entity,
  trigger_status,
  task_type,
  title_template,
  owner_kind,
  channel,
  due_hours,
  active
)
SELECT
  t.id,
  'Verfügbarkeit bestätigt → nächste Schritte planen',
  'participant',
  'availability_yes',
  'schedule_next_step',
  'Nächste Schritte planen (Verfügbarkeit bestätigt)',
  'internal_user',
  'internal',
  48,
  true
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1
  FROM routing_rules r
  WHERE r.tenant_id = t.id
    AND r.trigger_entity = 'participant'
    AND r.trigger_status = 'availability_yes'
    AND r.task_type = 'schedule_next_step'
);
