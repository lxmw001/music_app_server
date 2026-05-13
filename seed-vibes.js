// seed-vibes.js — populates the vibes collection in Firestore
// Usage:
//   node seed-vibes.js          → seeds dev (uses .env)
//   node seed-vibes.js --prod   → seeds prod (uses .env.prod)

const isProd = process.argv.includes('--prod');
require('dotenv').config({ path: isProd ? '.env.prod' : '.env' });

const admin = require('firebase-admin');

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
      { key: 'vibe_chill_jazz', promptLabel: 'Jazz suave', icon: '🎷' },
      { key: 'vibe_chill_nature', promptLabel: 'Naturaleza', icon: '🌿' },
      { key: 'vibe_chill_piano', promptLabel: 'Piano', icon: '🎹' },
      { key: 'vibe_chill_yoga', promptLabel: 'Yoga', icon: '🧘' },
    ],
  },
  {
    labelKey: 'vibe_energetic',
    promptLabel: 'Energético',
    icon: '⚡',
    order: 2,
    subCategories: [
      { key: 'vibe_energetic_hiit', promptLabel: 'HIIT / Cardio', icon: '🏋️' },
      { key: 'vibe_energetic_running', promptLabel: 'Correr', icon: '🏃' },
      { key: 'vibe_energetic_cycling', promptLabel: 'Ciclismo', icon: '🚴' },
      { key: 'vibe_energetic_sports', promptLabel: 'Deportes', icon: '⚽' },
      { key: 'vibe_energetic_dance', promptLabel: 'Baile', icon: '💃' },
    ],
  },
  {
    labelKey: 'vibe_party',
    promptLabel: 'Fiesta',
    icon: '🎉',
    order: 3,
    subCategories: [
      { key: 'vibe_party_club', promptLabel: 'Club / Discoteca', icon: '🪩' },
      { key: 'vibe_party_birthday', promptLabel: 'Cumpleaños', icon: '🎂' },
      { key: 'vibe_party_babyshower', promptLabel: 'Baby shower', icon: '🍼' },
      { key: 'vibe_party_kids', promptLabel: 'Infantil', icon: '🧸' },
      { key: 'vibe_party_wedding', promptLabel: 'Boda', icon: '💍' },
      { key: 'vibe_party_graduation', promptLabel: 'Graduación', icon: '🎓' },
      { key: 'vibe_party_bbq', promptLabel: 'Asado / BBQ', icon: '🍖' },
      { key: 'vibe_party_pregame', promptLabel: 'Previa', icon: '🥂' },
      { key: 'vibe_party_christmas', promptLabel: 'Navidad', icon: '🎄' },
      { key: 'vibe_party_halloween', promptLabel: 'Halloween', icon: '🎃' },
      { key: 'vibe_party_new_year', promptLabel: 'Año nuevo', icon: '🎆' },
    ],
  },
  {
    labelKey: 'vibe_romantic',
    promptLabel: 'Romántico',
    icon: '❤️',
    order: 4,
    subCategories: [
      { key: 'vibe_romantic_date', promptLabel: 'Cita', icon: '🕯️' },
      { key: 'vibe_romantic_ballad', promptLabel: 'Balada', icon: '🎶' },
      { key: 'vibe_romantic_wedding', promptLabel: 'Boda', icon: '💒' },
      { key: 'vibe_romantic_anniversary', promptLabel: 'Aniversario', icon: '💐' },
      { key: 'vibe_romantic_serenade', promptLabel: 'Serenata', icon: '🌹' },
    ],
  },
  {
    labelKey: 'vibe_sad',
    promptLabel: 'Melancólico',
    icon: '🌧️',
    order: 5,
    subCategories: [
      { key: 'vibe_sad_heartbreak', promptLabel: 'Desamor', icon: '💔' },
      { key: 'vibe_sad_nostalgic', promptLabel: 'Nostálgico', icon: '🕰️' },
      { key: 'vibe_sad_rainy', promptLabel: 'Día lluvioso', icon: '☔' },
      { key: 'vibe_sad_lonely', promptLabel: 'Soledad', icon: '🌑' },
      { key: 'vibe_sad_cry', promptLabel: 'Para llorar', icon: '😢' },
    ],
  },
  {
    labelKey: 'vibe_focus',
    promptLabel: 'Concentración',
    icon: '🧠',
    order: 6,
    subCategories: [
      { key: 'vibe_focus_study', promptLabel: 'Estudio', icon: '📚' },
      { key: 'vibe_focus_work', promptLabel: 'Trabajo', icon: '💻' },
      { key: 'vibe_focus_reading', promptLabel: 'Lectura', icon: '📖' },
      { key: 'vibe_focus_coding', promptLabel: 'Programar', icon: '👨‍💻' },
      { key: 'vibe_focus_meditation', promptLabel: 'Meditación', icon: '🧘' },
      { key: 'vibe_focus_deep_work', promptLabel: 'Trabajo profundo', icon: '🎯' },
    ],
  },
  {
    labelKey: 'vibe_happy',
    promptLabel: 'Alegre',
    icon: '😄',
    order: 7,
    subCategories: [
      { key: 'vibe_happy_summer', promptLabel: 'Verano', icon: '☀️' },
      { key: 'vibe_happy_feel_good', promptLabel: 'Buen ánimo', icon: '🌈' },
      { key: 'vibe_happy_morning', promptLabel: 'Mañana positiva', icon: '🌅' },
      { key: 'vibe_happy_road_trip', promptLabel: 'Viaje en auto', icon: '🚗' },
      { key: 'vibe_happy_beach', promptLabel: 'Playa', icon: '🏖️' },
      { key: 'vibe_happy_celebration', promptLabel: 'Celebración', icon: '🥳' },
    ],
  },
  {
    labelKey: 'vibe_latin',
    promptLabel: 'Latino',
    icon: '🌶️',
    order: 8,
    subCategories: [
      { key: 'vibe_latin_reggaeton', promptLabel: 'Reggaeton', icon: '🔥' },
      { key: 'vibe_latin_salsa', promptLabel: 'Salsa', icon: '💃' },
      { key: 'vibe_latin_cumbia', promptLabel: 'Cumbia', icon: '🪗' },
      { key: 'vibe_latin_bachata', promptLabel: 'Bachata', icon: '🌹' },
      { key: 'vibe_latin_merengue', promptLabel: 'Merengue', icon: '🥁' },
      { key: 'vibe_latin_vallenato', promptLabel: 'Vallenato', icon: '🪗' },
      { key: 'vibe_latin_pop', promptLabel: 'Pop latino', icon: '🎤' },
      { key: 'vibe_latin_trap', promptLabel: 'Trap latino', icon: '🎵' },
    ],
  },
  {
    labelKey: 'vibe_night',
    promptLabel: 'Noche',
    icon: '🌙',
    order: 9,
    subCategories: [
      { key: 'vibe_night_late', promptLabel: 'Trasnoche', icon: '🌃' },
      { key: 'vibe_night_club', promptLabel: 'Club', icon: '🪩' },
      { key: 'vibe_night_chill', promptLabel: 'Noche tranquila', icon: '🌌' },
      { key: 'vibe_night_drive', promptLabel: 'Manejar de noche', icon: '🚗' },
      { key: 'vibe_night_rooftop', promptLabel: 'Terraza', icon: '🏙️' },
    ],
  },
  {
    labelKey: 'vibe_sleep',
    promptLabel: 'Dormir',
    icon: '😴',
    order: 10,
    subCategories: [
      { key: 'vibe_sleep_deep', promptLabel: 'Sueño profundo', icon: '🌌' },
      { key: 'vibe_sleep_relax', promptLabel: 'Relajación', icon: '🛁' },
      { key: 'vibe_sleep_white_noise', promptLabel: 'Ruido blanco', icon: '🌬️' },
      { key: 'vibe_sleep_baby', promptLabel: 'Para bebés', icon: '👶' },
      { key: 'vibe_sleep_meditation', promptLabel: 'Meditación nocturna', icon: '🕯️' },
    ],
  },
  {
    labelKey: 'vibe_chores',
    promptLabel: 'Tareas del hogar',
    icon: '🏠',
    order: 11,
    subCategories: [
      { key: 'vibe_chores_cleaning', promptLabel: 'Limpieza', icon: '🧹' },
      { key: 'vibe_chores_cooking', promptLabel: 'Cocinando', icon: '🍳' },
      { key: 'vibe_chores_laundry', promptLabel: 'Lavando ropa', icon: '👕' },
      { key: 'vibe_chores_gardening', promptLabel: 'Jardín', icon: '🌱' },
      { key: 'vibe_chores_diy', promptLabel: 'Manualidades', icon: '🔨' },
    ],
  },
  {
    labelKey: 'vibe_gaming',
    promptLabel: 'Gaming',
    icon: '🎮',
    order: 12,
    subCategories: [
      { key: 'vibe_gaming_rpg', promptLabel: 'RPG Ambiental', icon: '⚔️' },
      { key: 'vibe_gaming_hype', promptLabel: 'Competitivo', icon: '🖱️' },
      { key: 'vibe_gaming_retro', promptLabel: 'Retro 8-bit', icon: '👾' },
    ],
  },
  {
    labelKey: 'vibe_travel',
    promptLabel: 'Viaje',
    icon: '✈️',
    order: 13,
    subCategories: [
      { key: 'vibe_travel_commute', promptLabel: 'Trayecto diario', icon: '🎧' },
      { key: 'vibe_travel_road_trip', promptLabel: 'Viaje en carretera', icon: '🛣️' },
      { key: 'vibe_travel_flying', promptLabel: 'Volando', icon: '☁️' },
    ],
  },
  {
    labelKey: 'vibe_nostalgia',
    promptLabel: 'Nostalgia',
    icon: '🕰️',
    order: 14,
    subCategories: [
      { key: 'vibe_nostalgia_80s', promptLabel: 'Años 80', icon: '📻' },
      { key: 'vibe_nostalgia_90s', promptLabel: 'Años 90', icon: '📼' },
      { key: 'vibe_nostalgia_2000s', promptLabel: 'Años 2000', icon: '💿' },
      { key: 'vibe_nostalgia_personal', promptLabel: 'Mi época', icon: '🎞️' },
      { key: 'vibe_nostalgia_childhood', promptLabel: 'Infancia', icon: '🧒' },
    ],
  },
];

async function run() {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });

  const db = admin.firestore();
  db.settings({ databaseId: process.env.FIRESTORE_DATABASE_ID || 'music-db' });

  const col = db.collection('vibes');
  const existing = await col.get();
  await Promise.all(existing.docs.map(d => d.ref.delete()));
  console.log(`Deleted ${existing.size} existing vibes`);

  for (const vibe of vibes) {
    const ref = await col.add(vibe);
    console.log(`Created: ${vibe.labelKey} (${ref.id})`);
  }

  console.log(`\nSeeded ${vibes.length} vibes successfully`);
  process.exit(0);
}

console.log(`Target: ${isProd ? 'PRODUCTION' : 'development'} — project: ${process.env.FIREBASE_PROJECT_ID}, db: ${process.env.FIRESTORE_DATABASE_ID || 'music-db'}`);

if (isProd) {
  const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Type "yes" to confirm seeding PRODUCTION: ', answer => {
    rl.close();
    if (answer.trim() !== 'yes') { console.log('Aborted.'); process.exit(0); }
    run().catch(err => { console.error(err); process.exit(1); });
  });
} else {
  run().catch(err => { console.error(err); process.exit(1); });
}
