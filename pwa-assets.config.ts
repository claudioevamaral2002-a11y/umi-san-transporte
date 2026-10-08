import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

const fundo = { background: '#0B2545' }

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: fundo },
    apple: { ...minimal2023Preset.apple, resizeOptions: fundo },
  },
  images: ['public/icone.svg'],
})
