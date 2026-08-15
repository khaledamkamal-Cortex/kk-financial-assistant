// Supabase Edge Function: notify-due-payment
// Sends a Web Push reminder for every UNPAID finance entry whose remind_at has
// passed and hasn't been notified yet, then stamps notified_at. Invoked on a
// schedule by pg_cron (see supabase/migrations/0002_reminders.sql).
//
// Deploy:   supabase functions deploy notify-due-payment
// Secrets:  VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT must be set
//           on this project. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are
//           injected automatically.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com'

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)

Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

  // Unpaid, due, not-yet-notified reminders.
  const { data: due, error } = await supabase
    .from('finance_entries')
    .select('id, user_id, title, fee, currency, site')
    .eq('paid', false)
    .not('remind_at', 'is', null)
    .is('notified_at', null)
    .lte('remind_at', new Date().toISOString())

  if (error) return json({ error: error.message }, 500)
  if (!due || due.length === 0) return json({ sent: 0, message: 'nothing due' })

  const userIds = [...new Set(due.map((d) => d.user_id))]
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('endpoint, user_id, p256dh, auth')
    .in('user_id', userIds)

  const subsByUser = new Map<string, typeof subs>()
  for (const s of subs ?? []) {
    const list = subsByUser.get(s.user_id) ?? []
    list.push(s)
    subsByUser.set(s.user_id, list)
  }

  let sent = 0
  const notifiedIds: string[] = []
  const deadEndpoints: string[] = []

  for (const e of due) {
    const userSubs = subsByUser.get(e.user_id) ?? []
    const amount = `${e.fee} ${e.currency}`
    const body = e.site ? `${e.title} — ${e.site} (${amount})` : `${e.title} (${amount})`
    const payload = JSON.stringify({
      title: 'Outstanding payment reminder',
      body,
      url: '/',
      tag: 'finance-' + e.id,
    })

    for (const s of userSubs) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload
        )
        sent++
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) deadEndpoints.push(s.endpoint)
      }
    }
    notifiedIds.push(e.id)
  }

  if (notifiedIds.length) {
    await supabase
      .from('finance_entries')
      .update({ notified_at: new Date().toISOString() })
      .in('id', notifiedIds)
  }
  if (deadEndpoints.length) {
    await supabase.from('push_subscriptions').delete().in('endpoint', deadEndpoints)
  }

  return json({ sent, entries: notifiedIds.length })
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
