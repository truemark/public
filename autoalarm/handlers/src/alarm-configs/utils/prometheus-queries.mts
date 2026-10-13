// EC2 Prometheus queries for prometheus rules
// Note: the instance label is matched as either "<privateIp>" or "<privateIp>:<port>".
// A ".*" suffix after the IP would also match longer IPs (e.g. 10.0.1.5 would
// match 10.0.1.50:9100), causing cross-instance alerts, so we only allow an
// optional port suffix via "(:\\d+)?".
export function EC2getCpuQuery(
  platform: string | null,
  escapedPrivateIp: string,
  instanceId: string,
  threshold: number,
): string {
  if (platform?.toLowerCase().includes('windows')) {
    return `100 - (rate(windows_cpu_time_total{instance=~"(${escapedPrivateIp}(:\\\\d+)?|${instanceId})", mode="idle"}[180s]) * 100) > ${threshold}`;
  } else {
    return `100 - (rate(node_cpu_seconds_total{mode="idle", instance=~"(${escapedPrivateIp}(:\\\\d+)?|${instanceId})"}[180s]) * 100) > ${threshold}`;
  }
}

export function EC2getMemoryQuery(
  platform: string | null,
  escapedPrivateIp: string,
  instanceId: string,
  threshold: number,
): string {
  if (platform?.toLowerCase().includes('windows')) {
    return `100 - ((windows_os_virtual_memory_free_bytes{instance=~"(${escapedPrivateIp}(:\\\\d+)?|${instanceId})"} / windows_os_virtual_memory_bytes{instance=~"(${escapedPrivateIp}(:\\\\d+)?|${instanceId})"}) * 100) > ${threshold}`;
  } else {
    return `100 - ((node_memory_MemAvailable_bytes{instance=~"(${escapedPrivateIp}(:\\\\d+)?|${instanceId})"} / node_memory_MemTotal_bytes{instance=~"(${escapedPrivateIp}(:\\\\d+)?|${instanceId})"}) * 100) > ${threshold}`;
  }
}

export function EC2getStorageQuery(
  platform: string | null,
  escapedPrivateIp: string,
  instanceId: string,
  threshold: number,
): string {
  if (platform?.toLowerCase().includes('windows')) {
    return `100 - ((windows_logical_disk_free_bytes{instance=~"(${escapedPrivateIp}(:\\\\d+)?|${instanceId})"} / windows_logical_disk_size_bytes{instance=~"(${escapedPrivateIp}(:\\\\d+)?|${instanceId})"}) * 100) > ${threshold}`;
  } else {
    return `100 - ((node_filesystem_free_bytes{instance=~"(${escapedPrivateIp}(:\\\\d+)?|${instanceId})"} / node_filesystem_size_bytes{instance=~"(${escapedPrivateIp}(:\\\\d+)?|${instanceId})"}) * 100) > ${threshold}`;
  }
}
