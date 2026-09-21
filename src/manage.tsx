import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { AppManage } from './AppManage'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppManage />
  </StrictMode>,
)
