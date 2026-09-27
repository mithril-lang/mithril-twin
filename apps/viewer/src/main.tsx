import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './base.css'
import { TwinHome } from './twin/home'

const root = document.getElementById('root')
if (!root) throw new Error('missing #root')

createRoot(root).render(
  <StrictMode>
    <TwinHome />
  </StrictMode>,
)
