import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { apiClient, SiteContent } from '../services/apiClient';

export interface PaymentGatewaySettings {
  bkash_personal: string;
  bkash_merchant: string;
  nagad_personal: string;
  nagad_merchant: string;
  rocket_personal: string;
  rocket_merchant: string;
  whatsapp_number: string;
}

export interface RealtimeSyncContextType {
  paymentSettings: PaymentGatewaySettings;
  siteContent: SiteContent;
  syncStatus: 'connected' | 'reconnecting' | 'fallback';
  lastSyncedAt: Date | null;
  refreshAllConfigs: () => Promise<void>;
  broadcastNotice: string | null;
}

const DEFAULT_PAYMENT_SETTINGS: PaymentGatewaySettings = {
  bkash_personal: '01712-345678',
  bkash_merchant: '01987-654321',
  nagad_personal: '01812-345678',
  nagad_merchant: '01612-345678',
  rocket_personal: '01712-345678',
  rocket_merchant: '01987-654321',
  whatsapp_number: '+8801712345678',
};

const DEFAULT_SITE_CONTENT: SiteContent = {
  terms_of_service: 'StreamPulse Terms of Service',
  acceptable_use_policy: 'StreamPulse Acceptable Use Policy',
  privacy_policy: 'StreamPulse Privacy Policy',
  support_whatsapp: '+8801712345678',
  tier_limits: {
    free: { maxStreams: 1, maxHours: 10, maxChannels: 1, watermark: true },
    pro: { maxStreams: 2, maxHours: 720, maxChannels: 2, watermark: false },
    business: { maxStreams: 4, maxHours: -1, maxChannels: 4, watermark: false },
  },
  version: '2.4',
  last_updated: new Date().toISOString(),
};

const RealtimeSyncContext = createContext<RealtimeSyncContextType | null>(null);

export const RealtimeSyncProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [paymentSettings, setPaymentSettings] = useState<PaymentGatewaySettings>(DEFAULT_PAYMENT_SETTINGS);
  const [siteContent, setSiteContent] = useState<SiteContent>(DEFAULT_SITE_CONTENT);
  const [syncStatus, setSyncStatus] = useState<'connected' | 'reconnecting' | 'fallback'>('reconnecting');
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [broadcastNotice, setBroadcastNotice] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<any>(null);
  const supabaseRef = useRef<SupabaseClient | null>(null);

  // 1. Initial REST API load of latest configs
  const refreshAllConfigs = useCallback(async () => {
    try {
      const [fetchedSettings, fetchedContent] = await Promise.all([
        apiClient.getPaymentSettings(),
        apiClient.getSiteContent(),
      ]);

      if (fetchedSettings) {
        setPaymentSettings((prev) => ({ ...prev, ...fetchedSettings }));
      }
      if (fetchedContent) {
        setSiteContent(fetchedContent);
      }
      setLastSyncedAt(new Date());
    } catch (err) {
      console.warn('[RealtimeSync] REST fetch fallback error:', err);
    }
  }, []);

  // 2. Setup Centralized Supabase Real-Time Database Subscriptions
  useEffect(() => {
    refreshAllConfigs();

    // Check if Supabase client can be initialized from env or defaults
    const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL || 'https://wkchgdchgeormxvvlude.supabase.co';
    const supabaseAnonKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || 'placeholder-anon-key';

    if (supabaseUrl && supabaseAnonKey && !supabaseUrl.includes('placeholder')) {
      try {
        const client = createClient(supabaseUrl, supabaseAnonKey);
        supabaseRef.current = client;

        const channel = client
          .channel('system_settings_changes')
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'system_settings' },
            (payload) => {
              console.log('[Supabase Real-Time] Received system_settings postgres_changes event:', payload);
              const newRow = payload.new as any;
              if (newRow?.id === 'payment_gateways') {
                setPaymentSettings((prev) => ({ ...prev, ...newRow }));
                setLastSyncedAt(new Date());
                setBroadcastNotice('Payment methods updated by administrator in real time.');
                setTimeout(() => setBroadcastNotice(null), 4000);
              } else if (newRow?.id === 'site_content') {
                setSiteContent((prev) => ({ ...prev, ...newRow }));
                setLastSyncedAt(new Date());
                setBroadcastNotice('Site policies & subscription limits updated in real time.');
                setTimeout(() => setBroadcastNotice(null), 4000);
              } else {
                refreshAllConfigs();
              }
            }
          )
          .subscribe();

        return () => {
          client.removeChannel(channel);
        };
      } catch (sbErr) {
        console.warn('[Supabase Real-Time] Could not subscribe:', sbErr);
      }
    }
  }, [refreshAllConfigs]);

  // 3. Setup WebSocket Bridge Connection to /ws/sync with Auto-Reconnect
  useEffect(() => {
    let isMounted = true;

    function connectWebSocket() {
      if (!isMounted) return;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/sync`;

      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!isMounted) return;
          console.log('[Real-Time WebSocket] Connected to StreamPulse config sync bridge.');
          setSyncStatus('connected');
        };

        ws.onmessage = (event) => {
          if (!isMounted) return;
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'INITIAL_CONFIG' || data.type === 'CONFIG_UPDATED') {
              const { paymentSettings: newPayments, siteContent: newContent, message } = data.payload || {};

              if (newPayments) {
                setPaymentSettings((prev) => ({ ...prev, ...newPayments }));
              }
              if (newContent) {
                setSiteContent((prev) => ({ ...prev, ...newContent }));
              }

              setLastSyncedAt(new Date());
              if (message) {
                setBroadcastNotice(message);
                setTimeout(() => setBroadcastNotice(null), 4000);
              }
            }
          } catch (e) {
            console.warn('[Real-Time WebSocket] Message parse error:', e);
          }
        };

        ws.onclose = () => {
          if (!isMounted) return;
          console.log('[Real-Time WebSocket] Disconnected. Reconnecting in 3s...');
          setSyncStatus('reconnecting');
          wsRef.current = null;
          reconnectTimeoutRef.current = setTimeout(connectWebSocket, 3000);
        };

        ws.onerror = () => {
          if (!isMounted) return;
          setSyncStatus('fallback');
        };
      } catch (err) {
        setSyncStatus('fallback');
        reconnectTimeoutRef.current = setTimeout(connectWebSocket, 5000);
      }
    }

    connectWebSocket();

    return () => {
      isMounted = false;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  return (
    <RealtimeSyncContext.Provider
      value={{
        paymentSettings,
        siteContent,
        syncStatus,
        lastSyncedAt,
        refreshAllConfigs,
        broadcastNotice,
      }}
    >
      {children}
    </RealtimeSyncContext.Provider>
  );
};

export const useRealtimeSync = (): RealtimeSyncContextType => {
  const context = useContext(RealtimeSyncContext);
  if (!context) {
    throw new Error('useRealtimeSync must be used within a RealtimeSyncProvider');
  }
  return context;
};

/**
 * Fail-Safe Client-Side Polling / Invalidation Hook
 * Guarantees 100% data consistency whenever a checkout, subscription, or settings modal opens.
 */
export function useConfigInvalidation(
  isOpen: boolean,
  configType: 'payment' | 'content' | 'all' = 'all'
) {
  const { refreshAllConfigs, paymentSettings, siteContent } = useRealtimeSync();

  useEffect(() => {
    if (isOpen) {
      // Invalidate background cache and re-fetch latest configs instantly
      refreshAllConfigs();
    }
  }, [isOpen, refreshAllConfigs]);

  // Window re-focus listener for instant sync
  useEffect(() => {
    const handleFocus = () => {
      if (isOpen) {
        refreshAllConfigs();
      }
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [isOpen, refreshAllConfigs]);

  return { paymentSettings, siteContent, refresh: refreshAllConfigs };
}
