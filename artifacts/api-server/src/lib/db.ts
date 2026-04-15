import mongoose, { Schema, model } from "mongoose";

export async function connectDB(): Promise<void> {
  const uri = process.env["MONGODB_URI"];
  if (!uri) throw new Error("MONGODB_URI environment variable is required");
  if (mongoose.connection.readyState !== 0) return;
  await mongoose.connect(uri);
}

const transformOpts = {
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret._id;
    delete ret.__v;
    return ret;
  },
};

const CounterSchema = new Schema({ _id: String, seq: { type: Number, default: 0 } });
const Counter = model("Counter", CounterSchema);

export async function nextId(name: string): Promise<number> {
  const result = await Counter.findByIdAndUpdate(name, { $inc: { seq: 1 } }, { upsert: true, new: true });
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
  { toJSON: transformOpts, toObject: transformOpts }
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
  { toJSON: transformOpts, toObject: transformOpts }
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
  { toJSON: transformOpts, toObject: transformOpts }
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
  { toJSON: transformOpts, toObject: transformOpts }
);

export const Server = model("Server", ServerSchema);
export const Site = model("Site", SiteSchema);
export const CloudflareConfig = model("CloudflareConfig", CloudflareConfigSchema);
export const Activity = model("Activity", ActivitySchema);

export type ServerDoc = ReturnType<(typeof Server.prototype)["toObject"]>;
export type SiteDoc = ReturnType<(typeof Site.prototype)["toObject"]>;
