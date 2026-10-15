import 'dotenv/config';
import { connectDB, mongoose, Setting, Sequence } from './db';

/**
 * "Migrations" for MongoDB: ensure indexes exist and the single-row
 * settings document / receipt sequence are in place. Idempotent.
 */
async function main() {
  await connectDB();

  // create/refresh all indexes defined on the models
  for (const name of mongoose.modelNames()) {
    await mongoose.model(name).syncIndexes();
    console.log(`✔ indexes ensured for ${name}`);
  }

  await Setting.updateOne({ id: 1 }, { $setOnInsert: { id: 1 } }, { upsert: true });
  await Sequence.updateOne({ name: 'receipt' }, { $setOnInsert: { name: 'receipt', value: 0 } }, { upsert: true });
  console.log('✔ defaults ensured (settings row, receipt sequence)');

  await mongoose.disconnect();
  console.log('Setup complete.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
