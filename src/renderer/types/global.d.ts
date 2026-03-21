import type { XovrApi } from '../../preload/preload'

declare global {
  interface Window {
    api: XovrApi
  }
}
