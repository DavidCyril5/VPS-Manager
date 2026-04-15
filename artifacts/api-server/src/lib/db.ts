import mongoose, { Schema, model } from "mongoose";

// id: false disables Mongoose's built-in _id virtual so our custom integer id field works properly
const baseOpts = {
  toJSON: {
    transform: (_doc: unknown, ret: Record<string, unknown>) => {
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
  toObject: {
    transform: (_doc: unknown, ret: Record<string, unknown>) => {
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
  id: false,
};

const CounterSchema = new Schema({ _id: String, seq: { type: Number, default: 0 } }, { id: false });
const Counter = model("Counter", CounterSchema);

export async function nextId(name: string): Promise<number> {
  const result = await Counter.findByIdAndUpdate(
    name,
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" }
  );
  return result!.seq as number;
}

const ServerSchema = new Schema(
  {
    id: { type: Number, unique: true, index: true },
    name: String,
    host: String,
    port: { type: Number, default: 22 },
    username: String,
    password: String,
    privateKey: { type: String, default: null },
    status: { type: String, default: "unknown" },
    nginxInstalled: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  baseOpts
);

const SiteSchema = new Schema(
  {
    id: { type: Number, unique: true, index: true },
    serverId: Number,
    name: String,
    domain: String,
    repoUrl: { type: String, default: null },
    repoToken: { type: String, default: null },
    deployPath: String,
    buildCommand: { type: String, default: null },
    siteType: { type: String, default: "static" },
    status: { type: String, default: "stopped" },
    autoSync: { type: Boolean, default: false },
    sslInstalled: { type: Boolean, default: false },
    sslExpiresAt: { type: Date, default: null },
    webhookToken: { type: String, default: null },
    lastDeployedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  baseOpts
);

const CloudflareConfigSchema = new Schema(
  {
    id: { type: Number, unique: true, index: true },
    label: String,
    email: String,
    apiToken: String,
    zoneId: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  baseOpts
);

const GitTokenSchema = new Schema(
  {
    id: { type: Number, unique: true, index: true },
    label: String,
    host: { type: String, default: "github.com" },
    token: String,
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  baseOpts
);

const ActivitySchema = new Schema(
  {
    id: { type: Number, unique: true, index: true },
    siteId: { type: Number, default: null },
    serverId: { type: Number, default: null },
    type: String,
    status: { type: String, default: "success" },
    message: String,
    details: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  baseOpts
);

export const Server = model("Server", ServerSchema);
export const Site = model("Site", SiteSchema);
export const CloudflareConfig = model("CloudflareConfig", CloudflareConfigSchema);
export const GitToken = model("GitToken", GitTokenSchema);
export const Activity = model("Activity", ActivitySchema);

async function repairMissingIds(): Promise<void> {
  // Fix documents that were created before the id:false fix — they have no integer id field
  const collections = [
    { model: Server, name: "servers" },
    { model: Site, name: "sites" },
    { model: CloudflareConfig, name: "cloudflare" },
    { model: Activity, name: "activity" },
  ];

  for (const { model: M, name } of collections) {
    // Find docs that don't have an id field (or id is null/undefined)
    const broken = await M.collection.find({ id: { $exists: false } }).toArray();
    for (const doc of broken) {
      const newId = await nextId(name);
      await M.collection.updateOne({ _id: doc._id }, { $set: { id: newId } });
    }
    if (broken.length > 0) {
      // Sync the counter to at least the highest id in the collection
      const maxDoc = await M.collection.findOne({}, { sort: { id: -1 } });
      if (maxDoc?.id) {
        await Counter.findByIdAndUpdate(
          name,
          { $max: { seq: maxDoc.id } },
          { upsert: true }
        );
      }
    }
  }
}

export async function connectDB(): Promise<void> {
  const uri = process.env["MONGODB_URI"];
  if (!uri) throw new Error("MONGODB_URI environment variable is required");
  if (mongoose.connection.readyState !== 0) return;
  await mongoose.connect(uri);
  await repairMissingIds();
}
