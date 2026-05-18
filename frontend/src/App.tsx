import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom'
import ActiveLearning from './views/ActiveLearning'
import ExportUpload from './views/ExportUpload'
import MatchManager from './views/MatchManager'
import RallyReview from './views/RallyReview'
import UploadProcess from './views/UploadProcess'

function NavItem({ to, label, end }: { to: string; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `block px-3 py-2 rounded text-sm ${isActive ? 'bg-blue-700 text-white' : 'text-gray-300 hover:text-white hover:bg-gray-700'}`
      }
    >
      {label}
    </NavLink>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex min-h-screen bg-gray-50">
        <nav className="w-44 bg-gray-900 p-3 flex flex-col gap-1 shrink-0">
          <span className="text-white font-bold text-sm mb-3 px-3">Volleyball CV</span>
          <NavItem to="/" label="Matches" end />
          <NavItem to="/active-learning" label="Active Learning" />
        </nav>
        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<MatchManager />} />
            <Route path="/matches/:matchId/upload" element={<UploadProcess />} />
            <Route path="/matches/:matchId/rally-review" element={<RallyReview />} />
            <Route path="/matches/:matchId/export" element={<ExportUpload />} />
            <Route path="/active-learning" element={<ActiveLearning />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
