import { getAccessToken } from './googleAuth';

export interface GmailMessageSummary {
  id: string;
  threadId: string;
  snippet?: string;
  subject?: string;
  from?: string;
  to?: string;
  date?: string;
  isUnread?: boolean;
}

export interface GmailUserProfile {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
}

export const gmailClient = {
  /**
   * Helper to execute authenticated Gmail API requests with Bearer token
   */
  async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = await getAccessToken();
    if (!token) {
      throw new Error('Authentication required: No active Google access token found.');
    }

    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('Accept', 'application/json');

    const res = await fetch(`https://gmail.googleapis.com/gmail/v1${endpoint}`, {
      ...options,
      headers,
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(
        errorData?.error?.message || `Gmail API error (${res.status}): ${res.statusText}`
      );
    }

    return res.json() as Promise<T>;
  },

  /**
   * Fetch authenticated user's Gmail profile
   */
  async getProfile(): Promise<GmailUserProfile> {
    return this.request<GmailUserProfile>('/users/me/profile');
  },

  /**
   * List recent messages from user's inbox
   */
  async listMessages(options: { maxResults?: number; q?: string; pageToken?: string } = {}): Promise<{
    messages: GmailMessageSummary[];
    nextPageToken?: string;
    resultSizeEstimate: number;
  }> {
    const params = new URLSearchParams();
    params.set('maxResults', String(options.maxResults || 20));
    if (options.q) params.set('q', options.q);
    if (options.pageToken) params.set('pageToken', options.pageToken);

    const listRes = await this.request<{
      messages?: Array<{ id: string; threadId: string }>;
      nextPageToken?: string;
      resultSizeEstimate?: number;
    }>(`/users/me/messages?${params.toString()}`);

    if (!listRes.messages || listRes.messages.length === 0) {
      return { messages: [], resultSizeEstimate: 0 };
    }

    // Fetch details for the first batch in parallel (up to 15)
    const detailPromises = listRes.messages.slice(0, 15).map(async (msg) => {
      try {
        const detail = await this.request<any>(
          `/users/me/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date`
        );
        const headers = detail.payload?.headers || [];
        const subject = headers.find((h: any) => h.name.toLowerCase() === 'subject')?.value || '(No Subject)';
        const from = headers.find((h: any) => h.name.toLowerCase() === 'from')?.value || '';
        const to = headers.find((h: any) => h.name.toLowerCase() === 'to')?.value || '';
        const date = headers.find((h: any) => h.name.toLowerCase() === 'date')?.value || '';
        const isUnread = detail.labelIds?.includes('UNREAD');

        return {
          id: msg.id,
          threadId: msg.threadId,
          snippet: detail.snippet,
          subject,
          from,
          to,
          date,
          isUnread,
        };
      } catch (e) {
        return {
          id: msg.id,
          threadId: msg.threadId,
          snippet: '',
          subject: '(Error loading message)',
        };
      }
    });

    const messages = await Promise.all(detailPromises);
    return {
      messages,
      nextPageToken: listRes.nextPageToken,
      resultSizeEstimate: listRes.resultSizeEstimate || messages.length,
    };
  },

  /**
   * Fetch full message content including body
   */
  async getMessage(id: string): Promise<any> {
    return this.request<any>(`/users/me/messages/${id}?format=full`);
  },

  /**
   * Send an email through user's Gmail account (RFC 2822 base64url encoded)
   */
  async sendEmail(options: {
    to: string;
    subject: string;
    bodyText: string;
    bodyHtml?: string;
    threadId?: string;
  }): Promise<{ id: string; threadId: string; labelIds: string[] }> {
    const { to, subject, bodyText, bodyHtml, threadId } = options;

    const boundary = `boundary_${Date.now()}`;
    let emailLines = [
      `To: ${to}`,
      `Subject: =?utf-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
      'MIME-Version: 1.0',
    ];

    if (bodyHtml) {
      emailLines.push(
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset="UTF-8"',
        '',
        bodyText,
        '',
        `--${boundary}`,
        'Content-Type: text/html; charset="UTF-8"',
        '',
        bodyHtml,
        '',
        `--${boundary}--`
      );
    } else {
      emailLines.push(
        'Content-Type: text/plain; charset="UTF-8"',
        '',
        bodyText
      );
    }

    const rawMessage = emailLines.join('\r\n');

    // Base64url encode
    const base64Encoded = btoa(unescape(encodeURIComponent(rawMessage)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const bodyPayload: any = { raw: base64Encoded };
    if (threadId) bodyPayload.threadId = threadId;

    return this.request<{ id: string; threadId: string; labelIds: string[] }>(
      '/users/me/messages/send',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
      }
    );
  },

  /**
   * Trash an email message (Moving to Trash)
   * Note: Destructive operations must require explicit user confirmation before executing!
   */
  async trashMessage(id: string): Promise<any> {
    return this.request<any>(`/users/me/messages/${id}/trash`, {
      method: 'POST',
    });
  },

  /**
   * Mark message as read
   */
  async markAsRead(id: string): Promise<any> {
    return this.request<any>(`/users/me/messages/${id}/modify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        removeLabelIds: ['UNREAD'],
      }),
    });
  },
};
