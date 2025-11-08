// ================================
// ENUMS
// ================================

// Sama seperti default status di SQL (Stopped)
export enum ChannelStatus {
  RUNNING = "RUNNING",
  STOPPED = "STOPPED",
  ERROR = "ERROR",
}

// Jenis destination (REST, MLLP, FILE, dll)
export enum DestinationType {
  HL7 = "HL7",
  REST = "REST",
}

// ================================
// ENTITY INTERFACES
// ================================

export interface Source {
  type: string; // dari kolom source_type
  endpoint: string; // dari kolom source_endpoint
}

export interface Destination {
  id: number;
  channel_id: number;
  name: string;
  type: DestinationType;
  endpoint: string;
  processingScript?: string;

  //  Tambahkan ini agar sesuai dengan mockData.ts
  sent?: number;
  errors?: number;
}

// ================================
// CHANNEL (utama di dashboard)
// ================================
export interface Channel {
  id: number; // INT IDENTITY(1,1)
  name: string;
  status: ChannelStatus; // NVARCHAR(20)
  source: Source; // type + endpoint
  destinations: Destination[]; // Relasi ke tabel Destinations
  processingScript?: string; // NVARCHAR(MAX)
  responseScript?: string; // NVARCHAR(MAX)
  created_at?: string;
  updated_at?: string;

  //  Tambahan untuk tampilan monitor dan statistik
  received?: number; // total pesan masuk (Messages direction=IN)
  sent?: number; // total pesan keluar (Messages direction=OUT)
  errors?: number; // jumlah error log
}

// ================================
// FORM DATA (untuk Create / Update Channel)
// ================================
export interface ChannelFormData {
  name: string;
  source: {
    type: string;
    endpoint: string;
  };
  destinations: {
    name: string;
    type: DestinationType;
    endpoint: string;
    processingScript?: string;
  }[];
  processingScript?: string;
  responseScript?: string;
}

// ================================
// MESSAGE LOG
// ================================
export interface MessageLog {
  id: number; // BIGINT IDENTITY
  channel_id: number;
  direction: "IN" | "OUT"; // sesuai tabel (IN/OUT)
  payload: string;
  status: "SUCCESS" | "ERROR";
  timestamp: string;
  // Relasi opsional untuk menampilkan channel name
  channel_name?: string;
}

// ================================
// USER TABLE
// ================================
export interface User {
  id: number;
  username: string;
  password_hash: string;
  name: string;
  role: string; // default 'admin'
}

// ================================
// MONITOR / DASHBOARD STATS
// ================================
export interface MonitorStats {
  totalReceived: number;
  totalSent: number;
  totalErrors: number;
  channelsRunning: number;
  channelsStopped: number;
  channelsError: number;
}

// ================================
// LOG SYSTEM (untuk realtime monitor/log viewer)
// ================================
export enum LogLevel {
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
  DEBUG = "DEBUG",
}

export interface LogEntry {
  id: number; // BIGINT - ID unik pesan/log
  timestamp: string; // Waktu log (ISO string)
  channelId: number; // ID channel terkait
  channelName: string; // Nama channel
  level: LogLevel; // Level log (INFO, ERROR, dsb.)
  message: string; // Pesan log ringkas
  content?: string; // Isi pesan (jika ada)
  error?: string; // Error message (jika ada)
  originalPayload?: string; // Data asli (sebelum transformasi)
  transformedPayload?: string; // Data hasil transformasi

  /** Status pesan (mirip status message di Mirth Connect)
   *  IN-PROCESS: Pesan baru diterima dan sedang diproses
   *  PROCESSED:  Sudah selesai diproses, menunggu kirim
   *  SENT / OUT-SENT: Berhasil dikirim ke destination
   *  ERROR: Gagal proses/kirim
   *  SKIPPED: Dilewati karena channel tidak aktif
   *  UNKNOWN: Default jika belum terdefinisi
   */
  status?: "IN-PROCESS" | "PROCESSED" | "SENT" | "OUT-SENT" | "ERROR" | "SKIPPED" | "UNKNOWN";

  /** Arah pesan (opsional, untuk menandai inbound/outbound) */
  direction?: "IN" | "OUT";
}
