import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create default event
  const event = await prisma.eventConfig.upsert({
    where: { id: 'default-event' },
    update: {},
    create: {
      id: 'default-event',
      name: 'QueueShield Security Challenge 2026',
      description: 'The ultimate bot detection stress test. Can your automation survive our multi-layered defense system?',
      venue: 'Digital Arena — Cyberspace',
      eventDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      totalTickets: 100,
      soldTickets: 0,
      isActive: true,
    },
  });
  console.log(`  Event: ${event.name}`);

  // Create default detector configs
  const detectorDefaults = [
    { key: 'passive.header_analysis.enabled', value: true, description: 'Enable HTTP header analysis' },
    { key: 'passive.header_analysis.weight', value: 1.0, description: 'Weight multiplier for header analysis scores' },
    { key: 'passive.ip_analysis.enabled', value: true, description: 'Enable IP reputation analysis' },
    { key: 'active.fingerprint.enabled', value: true, description: 'Enable client-side fingerprinting' },
    { key: 'active.fingerprint.weight', value: 1.5, description: 'Weight multiplier for fingerprint scores' },
    { key: 'behavior.telemetry.enabled', value: true, description: 'Enable mouse/keyboard telemetry analysis' },
    { key: 'behavior.telemetry.weight', value: 2.0, description: 'Weight multiplier for behavior scores' },
    { key: 'captcha.enabled', value: true, description: 'Enable CAPTCHA challenges for medium-risk sessions' },
    { key: 'captcha.provider', value: 'custom', description: 'CAPTCHA provider: custom | hcaptcha' },
    { key: 'autoban.enabled', value: true, description: 'Automatically ban high-risk sessions' },
    { key: 'autoban.threshold', value: 85, description: 'Risk score threshold for automatic ban' },
  ];

  for (const cfg of detectorDefaults) {
    await prisma.detectorConfig.upsert({
      where: { key: cfg.key },
      update: {},
      create: {
        key: cfg.key,
        value: cfg.value,
        description: cfg.description,
      },
    });
  }
  console.log(`  Detector configs: ${detectorDefaults.length} entries`);

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
