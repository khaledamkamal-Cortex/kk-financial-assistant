import { useState } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { navigate } from '../lib/router'
import { COUNTRIES } from '../data/countries'
import { t } from '../strings'

// ---------------------------------------------------------------------------
// Dedicated sign-up page (#/signup). Collects name, email, phone and country
// on top of the credentials; the extra fields are stored as Supabase user
// metadata (full_name / phone / country).
// ---------------------------------------------------------------------------

export default function SignUp() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [country, setCountry] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  const header = (
    <header className="app-header">
      <button className="app-header__back" onClick={() => navigate('')} aria-label={t.suBack}>
        ←
      </button>
      <h1 className="app-header__title">{t.suTitle}</h1>
    </header>
  )

  if (!isSupabaseConfigured || !supabase) {
    return (
      <>
        {header}
        <div className="screen">
          <div className="card page-card">
            <p className="muted">{t.suLocalMode}</p>
            <button className="btn btn--outline page-backbtn" onClick={() => navigate('')}>
              {t.suBack}
            </button>
          </div>
        </div>
      </>
    )
  }

  function validate(): string | null {
    if (!name.trim()) return t.suErrName
    if (!email.trim() || !email.includes('@')) return t.finErrEmailInvalid
    if (!/^[+\d][\d\s\-()]{5,}$/.test(phone.trim())) return t.suErrPhone
    if (!country) return t.suErrCountry
    if (password.length < 6) return t.finErrPasswordShort
    return null
  }

  async function submit() {
    setError('')
    setInfo('')
    const invalid = validate()
    if (invalid) {
      setError(invalid)
      return
    }
    setBusy(true)
    try {
      const { data, error: err } = await supabase!.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            full_name: name.trim(),
            phone: phone.trim(),
            country,
          },
        },
      })
      if (err) {
        if (/already registered/i.test(err.message)) setError(t.finErrAlreadyRegistered)
        else if (/password.*(at least|too short|characters)/i.test(err.message))
          setError(t.finErrPasswordShort)
        else if (/signups?( are)? (not allowed|disabled)/i.test(err.message))
          setError(t.finErrSignupsDisabled)
        else setError(err.message)
      } else if (data.session) {
        // Email confirmation is OFF — signed in right away; back to the ledger.
        navigate('')
      } else if (data.user && data.user.identities && data.user.identities.length === 0) {
        // Confirmation is ON and the email already exists: Supabase returns a
        // stub user with no identities instead of an error (anti-enumeration).
        setError(t.finErrAlreadyRegistered)
      } else {
        // Confirmation is ON — account created but no session yet.
        setInfo(t.finSignUpDone)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {header}
      <div className="screen">
        <form
          className="card page-card"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <p className="muted page-intro">{t.suIntro}</p>

          <div className="field">
            <label>{t.suName}</label>
            <input
              autoComplete="name"
              placeholder={t.suNamePh}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="field">
            <label>{t.finEmail}</label>
            <input
              type="email"
              autoComplete="email"
              placeholder={t.finEmail}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="field">
            <label>{t.suPhone}</label>
            <input
              type="tel"
              autoComplete="tel"
              placeholder={t.suPhonePh}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>

          <div className="field">
            <label>{t.suCountry}</label>
            <select value={country} onChange={(e) => setCountry(e.target.value)}>
              <option value="">{t.suCountrySelect}</option>
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>{t.finPassword}</label>
            <input
              type="password"
              autoComplete="new-password"
              placeholder={t.finPassword}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && <div className="error-text page-msg">{error}</div>}
          {info && <div className="muted page-msg">{info}</div>}

          <button className="btn btn--primary" type="submit" disabled={busy}>
            {t.suCreate}
          </button>
        </form>
      </div>
    </>
  )
}
