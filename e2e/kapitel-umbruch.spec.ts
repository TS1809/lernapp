import { expect, test } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectErrors, createExam, importPackage, onboard } from './helpers'

const TITLE = 'Schaltnetze: Funktionstabelle, DNF/KNF, KV-Diagramm und weitere Darstellungsformen'
const PKG = {
  format: 'lernapp-paket',
  formatVersion: 1,
  id: 'st-logik',
  title: 'ST – Logik',
  version: 1,
  chapters: [{ id: 'k2', title: TITLE }],
  cards: [{ uid: 'k2-f001-1', type: 'basic', chapter: 'k2', front: 'Nennen Sie die vier Darstellungsformen eines Logikzusammenhangs.', back: 'Antwort' }],
}

test('Langer Kapiteltitel bricht um und ragt nicht über die Karte hinaus', async ({ page }) => {
  const errors = collectErrors(page)
  const dir = mkdtempSync(join(tmpdir(), 'lernapp-chip-'))
  writeFileSync(join(dir, 'st.lernpaket.json'), JSON.stringify(PKG))
  await onboard(page)
  await createExam(page, 'Steuerungstechnik')
  await importPackage(page, join(dir, 'st.lernpaket.json'), 'Steuerungstechnik')
  await page.goto('./#/lernen/mobile')
  const chip = page.locator('.flashcard .chip', { hasText: TITLE })
  await expect(chip).toBeVisible()
  const card = (await page.locator('.flashcard').boundingBox())!
  const box = (await chip.boundingBox())!
  expect(box.x + box.width).toBeLessThanOrEqual(card.x + card.width)
  expect(errors).toEqual([])
})
