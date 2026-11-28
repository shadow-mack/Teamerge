// Renders every app, variant and menu bar icon from brand/app-icon.svg and brand/menu-bar-mark.svg.
// Usage: node config/scripts/brand/render-app-icons.mjs   (macOS; needs Google Chrome, sips, iconutil)
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const repo = resolve(import.meta.dirname, '../../..')
const chrome =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const work = mkdtempSync(join(tmpdir(), 'teamerge-icons-'))

function render(svgText, size, out, height = size) {
  const svg = join(work, 'source.svg')
  const html = join(work, 'source.html')
  writeFileSync(svg, svgText)
  writeFileSync(
    html,
    `<html><body style="margin:0;background:transparent"><img src="${pathToFileURL(svg).href}" width="${size}" height="${height}"></body></html>`
  )
  execFileSync(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--default-background-color=00000000',
      `--window-size=${size},${height}`,
      `--screenshot=${out}`,
      pathToFileURL(html).href
    ],
    { stdio: 'ignore' }
  )
}

function resize(source, size, out) {
  execFileSync('sips', ['-z', String(size), String(size), source, '--out', out], {
    stdio: 'ignore'
  })
}

// ICO with PNG-compressed entries, which Windows Vista and later read directly.
function writeIco(entries, out) {
  const images = entries.map(({ path }) => readFileSync(path))
  const header = Buffer.alloc(6 + 16 * entries.length)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)
  let offset = header.length
  entries.forEach(({ size }, index) => {
    const at = 6 + 16 * index
    header.writeUInt8(size % 256, at)
    header.writeUInt8(size % 256, at + 1)
    header.writeUInt16LE(1, at + 4)
    header.writeUInt16LE(32, at + 6)
    header.writeUInt32LE(images[index].length, at + 8)
    header.writeUInt32LE(offset, at + 12)
    offset += images[index].length
  })
  writeFileSync(out, Buffer.concat([header, ...images]))
}

// The bare mark from resources/teamerge-logo.svg, recoloured and placed in a width x height canvas.
function markSvg(color, width, height, markSize) {
  const logo = readFileSync(join(repo, 'resources/teamerge-logo.svg'), 'utf8')
  const body = logo
    .slice(logo.indexOf('>', logo.indexOf('<svg')) + 1, logo.lastIndexOf('</svg>'))
    .replaceAll('#fff', color)
  const x = (width - markSize) / 2
  const y = (height - markSize) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><svg x="${x}" y="${y}" width="${markSize}" height="${markSize}" viewBox="0 0 64 64" fill="none">${body}</svg></svg>`
}

function recolor(svgText, { from, to, mark, sheen }) {
  let text = svgText
    .replace('stop-color="#5e5ce6"', `stop-color="${from}"`)
    .replace('stop-color="#0071e3"', `stop-color="${to}"`)
    .replaceAll('stroke="#fff"', `stroke="${mark}"`)
    .replaceAll('fill="#fff"', `fill="${mark}"`)
  if (!sheen) {
    text = text.replace('stop-opacity=".22"', 'stop-opacity="0"')
  }
  return text
}

try {
  const icon = readFileSync(join(repo, 'brand/app-icon.svg'), 'utf8')
  const master = join(work, 'classic-1024.png')
  render(icon, 1024, master)

  const iconset = join(work, 'icon.iconset')
  mkdirSync(iconset)
  for (const points of [16, 32, 128, 256, 512]) {
    resize(master, points, join(iconset, `icon_${points}x${points}.png`))
    resize(master, points * 2, join(iconset, `icon_${points}x${points}@2x.png`))
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(repo, 'resources/build/icon.icns')])
  copyFileSync(master, join(repo, 'resources/build/icon.png'))

  const icoEntries = [16, 24, 32, 48, 64, 128, 256].map((size) => {
    const path = join(work, `ico-${size}.png`)
    resize(master, size, path)
    return { path, size }
  })
  writeIco(icoEntries, join(repo, 'resources/build/icon.ico'))

  resize(master, 256, join(repo, 'resources/icon.png'))
  resize(master, 256, join(repo, 'resources/icon-dev.png'))

  render(
    recolor(icon, { from: '#2c2c2e', to: '#111113', mark: '#8e8dff', sheen: true }),
    1024,
    join(repo, 'resources/app-icons/teamerge-midnight.png')
  )
  render(
    recolor(icon, { from: '#ffffff', to: '#e9eefb', mark: '#2f5fe8', sheen: false }),
    1024,
    join(repo, 'resources/app-icons/teamerge-light.png')
  )

  const menuBar = readFileSync(join(repo, 'brand/menu-bar-mark.svg'), 'utf8')
  render(menuBar, 16, join(repo, 'resources/tray/teamerge-menu-barTemplate.png'))
  render(menuBar, 32, join(repo, 'resources/tray/teamerge-menu-barTemplate@2x.png'))

  // Mobile app: iOS wants a full-bleed square; Android, the splash and notifications draw the bare mark.
  const fullBleed = icon
    .replaceAll(
      'x="100" y="100" width="824" height="824" rx="185"',
      'x="0" y="0" width="1024" height="1024"'
    )
    .replace(
      '<g transform="translate(192 182) scale(10)"',
      '<g transform="translate(152 142) scale(11.25)"'
    )
  render(fullBleed, 1024, join(repo, 'mobile/assets/icon.png'))
  resize(master, 48, join(repo, 'mobile/assets/favicon.png'))
  render(markSvg('#e5e5ea', 1024, 1024, 420), 1024, join(repo, 'mobile/assets/adaptive-icon.png'))
  render(markSvg('#ffffff', 400, 255, 190), 400, join(repo, 'mobile/assets/splash-icon.png'), 255)
  render(markSvg('#ffffff', 56, 56, 48), 56, join(repo, 'mobile/assets/notification-icon.png'))

  copyFileSync(join(repo, 'brand/app-icon.svg'), join(repo, 'site/public/icon.svg'))
  resize(master, 180, join(repo, 'site/public/apple-touch-icon.png'))
  console.log('Rendered app, variant, menu bar and site icons from brand/app-icon.svg')
} finally {
  rmSync(work, { recursive: true, force: true })
}
