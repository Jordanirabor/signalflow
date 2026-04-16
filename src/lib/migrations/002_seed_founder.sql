-- Seed a default founder for local development
INSERT INTO founder (id, email, name, product_context)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'founder@signalflow.dev',
  'Default Founder',
  'SignalFlow GTM Engine'
)
ON CONFLICT (id) DO NOTHING;
