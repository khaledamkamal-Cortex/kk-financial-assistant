import { useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { t } from '../strings'

// ---------------------------------------------------------------------------
// Minimal auth / sync bar.
//   • Supabase not configured → a muted "device-local mode" line.
//   • Configured + signed out  → compact email/password sign-in + sign-up.
//   • Configured + signed in   → the user's email + a sign-out button.
// `onAuthChange` fires on every auth state change so the tracker can reload.
// ---------------------------------------------------------------------------

type Props = {
  onAuthChange: () => void
}

export default function AccountBar({ onAuthChange }: Props) {
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email ?? null)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user?.email ?? null)
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

  async function signIn() {
    setError('')
    setInfo('')
    setBusy(true)
    try {
      const { error: err } = await supabase!.auth.signInWithPassword({ email, password })
      if (err) setError(err.message)
      else {
        setEmail('')
        setPassword('')
      }
    } finally {
      setBusy(false)
    }
  }

  async function signUp() {
    setError('')
    setInfo('')
    setBusy(true)
    try {
      const { error: err } = await supabase!.auth.signUp({ email, password })
      if (err) setError(err.message)
      else setInfo(t.finSignUpDone)
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

  if (userEmail) {
    return (
      <div className="accountbar">
        <span className="accountbar__email" title={t.finSignedInAs}>
          {userEmail}
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
          onClick={signUp}
          disabled={busy || !email || !password}
        >
          {t.finSignUp}
        </button>
      </form>
      {error && <div className="error-text">{error}</div>}
      {info && <div className="accountbar__info muted">{info}</div>}
    </div>
  )
}
