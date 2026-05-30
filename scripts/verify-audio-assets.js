const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')

const expectedSounds = [
  'assets/sounds/towers/arrow_attack.wav',
  'assets/sounds/towers/rocket_attack.wav',
  'assets/sounds/towers/barracks_attack.wav',
  'assets/sounds/towers/magic_attack.wav',
  'assets/sounds/enemies/grunt_death.wav',
  'assets/sounds/enemies/runner_death.wav',
  'assets/sounds/enemies/brute_death.wav',
  'assets/sounds/enemies/shade_death.wav',
  'assets/sounds/enemies/boss_death.wav',
  'assets/sounds/enemies/annaBoss_death.wav',
  'assets/sounds/enemies/familyBoss_death.wav'
]

const gameJs = fs.readFileSync(path.join(root, 'game.js'), 'utf8')
const failures = []

for (const relPath of expectedSounds) {
  const absPath = path.join(root, relPath)
  if (!fs.existsSync(absPath)) {
    failures.push(`missing sound file: ${relPath}`)
    continue
  }
  const header = fs.readFileSync(absPath, { encoding: null, flag: 'r' }).subarray(0, 12)
  if (header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE') {
    failures.push(`invalid wav header: ${relPath}`)
  }
}

for (const key of [
  'towerAttackSounds',
  'enemyDeathSounds',
  'preloadSoundEffects',
  'configureAudioPlayback',
  'setInnerAudioOption',
  'playSound',
  'playTowerAttackSound',
  'playEnemyDeathSound'
]) {
  if (!gameJs.includes(key)) failures.push(`game.js missing ${key}`)
}

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log(`verified ${expectedSounds.length} sound assets and game.js audio hooks`)
