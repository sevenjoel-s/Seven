export const DEFAULT_RTC_CONFIGURATION: RTCConfiguration = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ],
};

let cachedIceConfig: { config: RTCConfiguration; fetchedAt: number } | null = null;

export async function fetchRtcConfiguration(getToken: () => Promise<string | null>): Promise<RTCConfiguration> {
  if (cachedIceConfig && Date.now() - cachedIceConfig.fetchedAt < 5 * 60_000) {
    return cachedIceConfig.config;
  }
  try {
    const token = await getToken();
    if (!token) return DEFAULT_RTC_CONFIGURATION;
    const resp = await fetch('/api/rtc/config', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return DEFAULT_RTC_CONFIGURATION;
    const data = await resp.json();
    if (Array.isArray(data.iceServers) && data.iceServers.length > 0) {
      const config: RTCConfiguration = { iceServers: data.iceServers };
      cachedIceConfig = { config, fetchedAt: Date.now() };
      return config;
    }
  } catch {
    // Graceful STUN fallback
  }
  return DEFAULT_RTC_CONFIGURATION;
}
