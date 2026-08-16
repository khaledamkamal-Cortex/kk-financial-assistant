import Tracker from './pages/Tracker'
import SignUp from './pages/SignUp'
import Settings from './pages/Settings'
import { useHashRoute } from './lib/router'

export default function App() {
  const route = useHashRoute()
  const page = route.startsWith('#/signup') ? (
    <SignUp />
  ) : route.startsWith('#/settings') ? (
    <Settings />
  ) : (
    <Tracker />
  )
  return <div className="app-shell">{page}</div>
}
