// seed-vibes.js — populates the vibes collection in Firestore
// Usage: node seed-vibes.js
require('dotenv').config();
const admin = require('firebase-admin');

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  }),
});

const db = admin.firestore();
db.settings({ databaseId: process.env.FIRESTORE_DATABASE_ID || 'music-db' });

const vibes = [
  {
    labelKey: 'vibe_chill',
    promptLabel: 'Relajado',
    icon: '😌',
    order: 1,
    subCategories: [
      { key: 'vibe_chill_lofi', promptLabel: 'Lofi', icon: '🎧' },
      { key: 'vibe_chill_acoustic', promptLabel: 'Acústico', icon: '🎸' },
      { key: 'vibe_chill_ambient', promptLabel: 'Ambiental', icon: '🌊' },
    ],
  },
  {
    labelKey: 'vibe_energetic',
    promptLabel: 'Energético',
    icon: '⚡',
    order: 2,
    subCategories: [
      { key: 'vibe_energetic_workout', promptLabel: 'Ejercicio', icon: '🏋️' },
      { key: 'vibe_energetic_party', promptLabel: 'Fiesta', icon: '🎉' },
      { key: 'vibe_energetic_running', promptLabel: 'Correr', icon: '🏃' },
    ],
  },
  {
    labelKey: 'vibe_romantic',
    promptLabel: 'Romántico',
    icon: '❤️',
    order: 3,
    subCategories: [
      { key: 'vibe_romantic_date', promptLabel: 'Cita', icon: '🕯️' },
      { key: 'vibe_romantic_ballad', promptLabel: 'Balada', icon: '🎶' },
    ],
  },
  {
    labelKey: 'vibe_sad',
    promptLabel: 'Melancólico',
    icon: '🌧️',
    order: 4,
    subCategories: [
      { key: 'vibe_sad_heartbreak', promptLabel: 'Desamor', icon: '💔' },
      { key: 'vibe_sad_nostalgic', promptLabel: 'Nostálgico', icon: '🕰️' },
    ],
  },
  {
    labelKey: 'vibe_focus',
    promptLabel: 'Concentración',
    icon: '🧠',
    order: 5,
    subCategories: [
      { key: 'vibe_focus_study', promptLabel: 'Estudio', icon: '📚' },
      { key: 'vibe_focus_work', promptLabel: 'Trabajo', icon: '💻' },
    ],
  },
  {
    labelKey: 'vibe_happy',
    promptLabel: 'Alegre',
    icon: '😄',
    order: 6,
    subCategories: [
      { key: 'vibe_happy_summer', promptLabel: 'Verano', icon: '☀️' },
      { key: 'vibe_happy_feel_good', promptLabel: 'Buen ánimo', icon: '🌈' },
    ],
  },
  {
    labelKey: 'vibe_latin',
    promptLabel: 'Latino',
    icon: '🌶️',
    order: 7,
    subCategories: [
      { key: 'vibe_latin_reggaeton', promptLabel: 'Reggaeton', icon: '🔥' },
      { key: 'vibe_latin_salsa', promptLabel: 'Salsa', icon: '💃' },
      { key: 'vibe_latin_cumbia', promptLabel: 'Cumbia', icon: '🪗' },
    ],
  },
  {
    labelKey: 'vibe_night',
    promptLabel: 'Noche',
    icon: '🌙',
    order: 8,
    subCategories: [
      { key: 'vibe_night_late', promptLabel: 'Trasnoche', icon: '🌃' },
      { key: 'vibe_night_club', promptLabel: 'Club', icon: '🪩' },
    ],
  },
];

async function seed() {
  const col = db.collection('vibes');

  // Clear existing
  const existing = await col.get();
  const deletes = existing.docs.map(d => d.ref.delete());
  await Promise.all(deletes);
  console.log(`Deleted ${existing.size} existing vibes`);

  // Insert new
  for (const vibe of vibes) {
    const ref = await col.add(vibe);
    console.log(`Created: ${vibe.labelKey} (${ref.id})`);
  }

  console.log(`\nSeeded ${vibes.length} vibes successfully`);
  process.exit(0);
}

seed().catch(err => { console.error(err); process.exit(1); });
