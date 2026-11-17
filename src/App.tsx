import { Route, Routes } from 'react-router'
import Home from './pages/Home.tsx'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="*" element={<h1>404</h1>} />
    </Routes>
  )
}
