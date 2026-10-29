import os from 'node:os';

export interface MemoryReport {
  rssMb: number;
  heapTotalMb: number;
  heapUsedMb: number;
  externalMb: number;
  osFreeMb: number;
  osTotalMb: number;
  osUsedPercent: number;
  isMemoryConstrained: boolean;
}

export interface SystemMetrics {
  uptimeSeconds: number;
  nodeVersion: string;
  platform: string;
  architecture: string;
  cpuCount: number;
  loadAverage: number[];
  memory: MemoryReport;
}

export function getMemoryReport(): MemoryReport {
  const mem = process.memoryUsage();
  const bytesToMb = (b: number) => Math.round((b / (1024 * 1024)) * 100) / 100;

  const freeMem = os.freemem();
  const totalMem = os.totalmem();
  const usedMem = totalMem - freeMem;
  const osUsedPercent = Math.round((usedMem / totalMem) * 10000) / 100;

  // On 8 GB RAM machines, alert if Node RSS exceeds 1.2 GB or system free memory is < 10%
  const rssMb = bytesToMb(mem.rss);
  const osFreeMb = bytesToMb(freeMem);
  const isMemoryConstrained = rssMb > 1200 || osUsedPercent > 90;

  return {
    rssMb,
    heapTotalMb: bytesToMb(mem.heapTotal),
    heapUsedMb: bytesToMb(mem.heapUsed),
    externalMb: bytesToMb(mem.external),
    osFreeMb,
    osTotalMb: bytesToMb(totalMem),
    osUsedPercent,
    isMemoryConstrained,
  };
}

export function getSystemMetrics(): SystemMetrics {
  return {
    uptimeSeconds: Math.floor(process.uptime()),
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
    cpuCount: os.cpus().length,
    loadAverage: os.loadavg(),
    memory: getMemoryReport(),
  };
}
