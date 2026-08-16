import { useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { navigate } from '../lib/router'
import { t } from '../strings'

// ---------------------------------------------------------------------------
// Minimal auth / sync bar.
//   • Supabase not configured → a muted "device-local mode" line.
//   • Configured + signed out  → compact email/password sign-in; the sign-up
//     button opens the dedicated sign-up page (#/signup).
//   • Configured + signed in   → the user's name (or email) + sign-out.
// `onAuthChange` fires on every auth state change so the tracker can reload.
// ---------------------------------------------------------------------------

type Props = {
  onAuthChange: () => void
}

export default function AccountBar({ onAuthChange }: Props) {
  const [userLabel, setUserLabel] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getUser().then(({ data }) => {
      const u = data.user
      setUserLabel(u ? (u.user_metadata?.full_name as string | undefined) || u.email || null : null)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user
      setUserLabel(u ? (u.user_metadata?.full_name as string | undefined) || u.email || null : null)
      onAuthChange()
    })
    return () => {
      sub.subscription.unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!isSupabaseConfigured || !supabase) {
    return <div className="accountbar accountbar--local muted">{t.finLocalMode}</div>
  }

  // Client-side validation before hitting the API. Returns an error string or null.
  function validate(): string | null {
    if (!email.trim() || !email.includes('@')) return t.finErrEmailInvalid
    if (password.length < 6) return t.finErrPasswordShort
    return null
  }

  async function signIn() {
    setError('')
    const invalid = validate()
    if (invalid) {
      setError(invalid)
      return
    }
    setBusy(true)
    try {
      const { error: err } = await supabase!.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (err) {
        if (/invalid login credentials/i.test(err.message)) setError(t.finErrWrongCredentials)
        else if (/email not confirmed/i.test(err.message)) setError(t.finErrEmailNotConfirmed)
        else setError(err.message)
      } else {
        // Success — onAuthStateChange updates the UI and reloads the data.
        setEmail('')
        setPassword('')
      }
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    setBusy(true)
    try {
      await supabase!.auth.signOut()
    } finally {
      setBusy(false)
    }
  }

  if (userLabel) {
    return (
      <div className="accountbar">
        <span className="accountbar__email" title={t.finSignedInAs}>
          {userLabel}
        </span>
        <button className="btn btn--outline accountbar__btn" onClick={signOut} disabled={busy}>
          {t.finSignOut}
        </button>
      </div>
    )
  }

  return (
    <div className="accountbar accountbar--form">
      <form
        className="accountbar__row"
        onSubmit={(e) => {
          e.preventDefault()
          void signIn()
        }}
      >
        <input
          type="email"
          autoComplete="email"
          placeholder={t.finEmail}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          type="password"
          autoComplete="current-password"
          placeholder={t.finPassword}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button className="btn btn--primary accountbar__btn" type="submit" disabled={busy || !email || !password}>
          {t.finSignIn}
        </button>
        <button
          className="btn btn--ghost accountbar__btn"
          type="button"
          onClick={() => navigate('#/signup')}
          disabled={busy}
        >
          {t.finSignUp}
        </button>
      </form>
      {error && <div className="error-text">{error}</div>}
    </div>
  )
}
