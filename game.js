const GRID_COLS = 18
const GRID_ROWS = 20
const TOWER_SIZE = 2
const TWO_PI = Math.PI * 2

// 微信小游戏 Canvas 入口：本项目没有页面层，全部游戏逻辑和绘制都在这个画布上运行。
const canvas = wx.createCanvas()
const ctx = canvas.getContext('2d')
const systemInfo = wx.getSystemInfoSync()
const DPR = systemInfo.pixelRatio || 1
const W = systemInfo.windowWidth
const H = systemInfo.windowHeight
const SAFE_AREA = systemInfo.safeArea || {
  top: systemInfo.statusBarHeight || 0,
  bottom: H
}
const SAFE_TOP = Math.max(systemInfo.statusBarHeight || 0, SAFE_AREA.top || 0) + 10
const SAFE_BOTTOM = Math.max(10, H - (SAFE_AREA.bottom || H) + 10)

canvas.width = W * DPR
canvas.height = H * DPR

// 四类塔的基础数值。升级会在已建塔实例上继续放大这些属性。
const towerTypes = {
  arrow: { id: 'arrow', name: '箭塔', icon: '弓', image: 'assets/icons/tower_arrow.png', cost: 45, color: '#f8fafc', range: 4.2, damage: 16, cooldown: 480 },
  rocket: { id: 'rocket', name: '火箭塔', icon: '炮', image: 'assets/icons/tower_rocket.png', cost: 80, color: '#f97316', range: 3.7, damage: 28, cooldown: 1050, splash: 1.4 },
  barracks: { id: 'barracks', name: '兵营', icon: '营', image: 'assets/icons/tower_barracks.png', cost: 65, color: '#22c55e', range: 2.7, damage: 8, cooldown: 820 },
  magic: { id: 'magic', name: '魔法塔', icon: '法', image: 'assets/icons/tower_magic.png', cost: 70, color: '#a78bfa', range: 4.0, damage: 12, cooldown: 760, slow: 0.48 }
}

const towerList = Object.keys(towerTypes).map((key) => towerTypes[key])

// 普通敌人的差异化配置。hp/speed/reward/attack 是倍率，blockImmune 表示能否无视兵营士兵阻挡。
const enemyTypes = {
  grunt: { id: 'grunt', name: '步兵', mark: '', image: 'assets/icons/enemy_grunt.png', color: '#f43f5e', hp: 1, speed: 1, reward: 1, radius: 1, attack: 1, blockImmune: false },
  runner: { id: 'runner', name: '疾行兵', mark: 'S', image: 'assets/icons/enemy_runner.png', color: '#facc15', hp: 0.62, speed: 1.48, reward: 1, radius: 0.9, attack: 0.82, blockImmune: false },
  brute: { id: 'brute', name: '重甲兵', mark: 'H', image: 'assets/icons/enemy_brute.png', color: '#fb923c', hp: 1.85, speed: 0.68, reward: 1.45, radius: 1.2, attack: 1.38, blockImmune: false },
  shade: { id: 'shade', name: '幽影兵', mark: 'G', image: 'assets/icons/enemy_shade.png', color: '#c084fc', hp: 0.9, speed: 1.08, reward: 1.25, radius: 0.95, attack: 0.9, blockImmune: true },
  boss: { id: 'boss', name: 'Boss', mark: 'B', image: 'assets/icons/enemy_boss.png', color: '#dc2626', hp: 1, speed: 1, reward: 1, radius: 1.55, attack: 1.65, blockImmune: false }
}

const specialBossTypes = {
  anna: { id: 'annaBoss', name: 'Anna Boss', mark: 'A', image: 'assets/icons/anna.png', color: '#f472b6', every: 5, radius: 1.75, attack: 1.85, hpScale: 1.45, rewardScale: 1.55 },
  family: { id: 'familyBoss', name: 'Family Boss', mark: 'F', image: 'assets/icons/familly.png', color: '#38bdf8', every: 10, radius: 2.05, attack: 2.15, hpScale: 2.15, rewardScale: 2.35 }
}

const enemyTypeOrder = ['grunt', 'runner', 'brute', 'shade']
const soldierIconPath = 'assets/icons/soldier_barracks.png'
const iconImages = {}

// 全局游戏状态：只放会影响玩法流程或结算的数据，绘制布局单独放在 layout。
const state = {
  gold: 160,
  lives: 20,
  wave: 0,
  running: false,
  gameOver: false,
  gameSpeed: 1,
  freezeCooldown: 0,
  freezeTimer: 0,
  stasisTimer: 0,
  powerCooldown: 0,
  powerTimer: 0,
  selectedTowerType: 'arrow',
  selectedTowerId: null,
  pendingBuildCell: null,
  message: '选择塔并点击地图建造',
  kills: 0,
  escaped: 0,
  earnedGold: 0,
  spentGold: 0,
  towersBuilt: 0
}

let map
let towers = []
let enemies = []
let projectiles = []
let soldiers = []
let effects = []
let spawnQueue = []
let spawnTimer = 0
let bossCurtain = null
let lastTime = Date.now()
let layout = {}

// 预加载 PNG 图标；加载失败时保留 Canvas fallback，避免资源问题导致单位不可见。
function preloadIconImages() {
  const paths = []
  Object.keys(towerTypes).forEach((key) => paths.push(towerTypes[key].image))
  Object.keys(enemyTypes).forEach((key) => paths.push(enemyTypes[key].image))
  Object.keys(specialBossTypes).forEach((key) => paths.push(specialBossTypes[key].image))
  paths.push(soldierIconPath)
  paths.forEach((path) => {
    if (!path || iconImages[path]) return
    const image = wx.createImage()
    image.loaded = false
    image.failed = false
    image.onload = () => {
      image.loaded = true
    }
    image.onerror = () => {
      image.failed = true
    }
    image.src = path
    iconImages[path] = image
  })
}

function getIconImage(path) {
  const image = iconImages[path]
  return image && image.loaded && !image.failed ? image : null
}

function drawCenteredImage(image, x, y, w, h) {
  ctx.drawImage(image, x - w / 2, y - h / 2, w, h)
}

// 重置完整局面。随机地图会重建，结算统计也从零开始。
function resetGame() {
  Object.assign(state, {
    gold: 160,
    lives: 20,
    wave: 0,
    running: false,
    gameOver: false,
    gameSpeed: 1,
    freezeCooldown: 0,
    freezeTimer: 0,
    stasisTimer: 0,
    powerCooldown: 0,
    powerTimer: 0,
    selectedTowerType: 'arrow',
    selectedTowerId: null,
    pendingBuildCell: null,
    message: '随机地图已生成，准备防守',
    kills: 0,
    escaped: 0,
    earnedGold: 0,
    spentGold: 0,
    towersBuilt: 0
  })
  towers = []
  enemies = []
  projectiles = []
  soldiers = []
  effects = []
  spawnQueue = []
  spawnTimer = 0
  bossCurtain = null
  map = createMap()
  updateLayout()
}

// 根据屏幕和安全区计算 HUD、地图、控制区位置，避免 iPhone 刘海和底部手势条遮挡。
function updateLayout() {
  const hudH = 58
  const gap = 10
  const controlsH = 196
  const maxBoardW = W - 20
  const safeContentH = H - SAFE_TOP - SAFE_BOTTOM
  const maxBoardH = safeContentH - hudH - controlsH
  const cell = Math.max(8, Math.floor(Math.min(maxBoardW / GRID_COLS, maxBoardH / GRID_ROWS)))
  const boardW = cell * GRID_COLS
  const boardH = cell * GRID_ROWS
  layout = {
    hudY: SAFE_TOP,
    boardX: (W - boardW) / 2,
    boardY: SAFE_TOP + hudH + gap,
    boardW,
    boardH,
    cell,
    controlsY: SAFE_TOP + hudH + gap + boardH + 12,
    safeTop: SAFE_TOP,
    safeBottom: SAFE_BOTTOM,
    buttons: [],
    buildButtons: [],
    actionButtons: [],
    skillButtons: []
  }
  layout.upgradeButton = null
  layout.sellButton = null
  layout.buildButtons = []
  layout.skillButtons = []
  refreshMapMetrics()
  buildButtons()
}

// 底部固定操作按钮；地图内建塔菜单由 updateBuildMenuButtons 单独生成。
function buildButtons() {
  const x = 10
  const y = layout.controlsY
  const gap = 8
  const bw = (W - 20 - gap * 2) / 3
  layout.actionButtons = [
    { id: 'wave', text: `开始第 ${state.wave + 1} 轮`, x, y, w: bw, h: 44 },
    { id: 'map', text: '随机地图', x: x + bw + gap, y, w: bw, h: 44 },
    { id: 'speed', text: `${state.gameSpeed}x速度`, x: x + (bw + gap) * 2, y, w: bw, h: 44 }
  ]
  const skillY = y + 52
  layout.skillButtons = [
    { id: 'freeze', text: '冻结', x, y: skillY, w: (W - 20 - gap) / 2, h: 42 },
    { id: 'power', text: '强攻', x: x + (W - 20 - gap) / 2 + gap, y: skillY, w: (W - 20 - gap) / 2, h: 42 }
  ]
  updateBuildMenuButtons()
}

// 点击空地后，四种建塔选项直接浮在地图上，并尽量夹在棋盘范围内。
function updateBuildMenuButtons() {
  layout.buildButtons = []
  const cell = state.pendingBuildCell
  if (!cell) return

  const buttonW = Math.max(50, Math.min(62, layout.cell * 4.2))
  const buttonH = Math.max(38, Math.min(46, layout.cell * 3.1))
  const gap = 6
  const menuW = buttonW * 2 + gap
  const menuH = buttonH * 2 + gap
  const anchorX = layout.boardX + (cell.col + TOWER_SIZE / 2) * layout.cell
  const anchorY = layout.boardY + (cell.row + TOWER_SIZE / 2) * layout.cell
  let x = anchorX - menuW / 2
  let y = anchorY - menuH - layout.cell * 0.5

  const minX = layout.boardX + 4
  const maxX = layout.boardX + layout.boardW - menuW - 4
  const minY = layout.boardY + 4
  const maxY = layout.boardY + layout.boardH - menuH - 4
  x = Math.max(minX, Math.min(maxX, x))
  if (y < minY) y = anchorY + layout.cell * 1.5
  y = Math.max(minY, Math.min(maxY, y))

  layout.buildButtons = towerList.map((tower, index) => ({
    id: tower.id,
    x: x + (index % 2) * (buttonW + gap),
    y: y + Math.floor(index / 2) * (buttonH + gap),
    w: buttonW,
    h: buttonH
  }))
}

// 随机地图会多次尝试带短折线的路线；如果出现自交，则退回到更稳定的无折线蛇形。
function createMap() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const candidate = buildRouteMap(true)
    if (!hasRepeatedPathCells(candidate.pathCells)) return candidate
  }
  return buildRouteMap(false)
}

// 构建一条横向或纵向蛇形路线。laneGap 用来给 2x2 塔预留可建造空间。
function buildRouteMap(allowSideBends) {
  const blocked = {}
  const pathCells = []
  const laneGap = TOWER_SIZE + 2
  let col = 0
  let row = 0

  function cellKey(nextCol, nextRow) {
    return `${nextCol},${nextRow}`
  }

  function isInside(nextCol, nextRow) {
    return nextCol >= 0 && nextCol < GRID_COLS && nextRow >= 0 && nextRow < GRID_ROWS
  }

  function canUseCell(nextCol, nextRow) {
    const last = pathCells[pathCells.length - 1]
    if (last && last.col === nextCol && last.row === nextRow) return true
    return isInside(nextCol, nextRow) && !blocked[cellKey(nextCol, nextRow)]
  }

  function hasNearbyOldRoute(nextCol, nextRow) {
    const recentStart = Math.max(0, pathCells.length - 7)
    for (let i = 0; i < recentStart; i += 1) {
      const cell = pathCells[i]
      if (Math.abs(cell.col - nextCol) < TOWER_SIZE + 1 && Math.abs(cell.row - nextRow) < TOWER_SIZE + 1) {
        return true
      }
    }
    return false
  }

  function addCell(nextCol, nextRow) {
    const safeCol = Math.max(0, Math.min(GRID_COLS - 1, nextCol))
    const safeRow = Math.max(0, Math.min(GRID_ROWS - 1, nextRow))
    const last = pathCells[pathCells.length - 1]
    if (last && last.col === safeCol && last.row === safeRow) return
    pathCells.push({ col: safeCol, row: safeRow })
    blocked[`${safeCol},${safeRow}`] = true
    col = safeCol
    row = safeRow
  }

  function makeLanes(count, size, minGap) {
    const lanes = []
    const min = 1
    const max = size - 2
    const step = Math.max(minGap, Math.floor((max - min) / Math.max(1, count - 1)))
    for (let i = 0; i < count; i += 1) {
      const percent = count === 1 ? 0.5 : i / (count - 1)
      const base = Math.round(min + (max - min) * percent)
      const jitter = randInt(-1, 1)
      const lane = Math.max(min, Math.min(max, base + jitter))
      const farEnough = lanes.every((usedLane) => Math.abs(usedLane - lane) >= minGap)
      if (farEnough) lanes.push(lane)
    }
    lanes.sort((a, b) => a - b)

    for (let lane = min; lanes.length < count && lane <= max; lane += step) {
      if (lanes.every((usedLane) => Math.abs(usedLane - lane) >= minGap)) lanes.push(lane)
    }
    lanes.sort((a, b) => a - b)
    return lanes
  }

  function walkToCol(targetCol) {
    const step = targetCol > col ? 1 : -1
    let stepsSinceTurn = 0
    while (col !== targetCol) {
      addCell(col + step, row)
      stepsSinceTurn += 1
      if (allowSideBends && stepsSinceTurn >= randInt(2, 4) && Math.abs(targetCol - col) > 3 && Math.random() < 0.55) {
        addSideBend('horizontal', step, targetCol)
        stepsSinceTurn = 0
      }
    }
  }

  function walkToRow(targetRow) {
    const step = targetRow > row ? 1 : -1
    let stepsSinceTurn = 0
    while (row !== targetRow) {
      addCell(col, row + step)
      stepsSinceTurn += 1
      if (allowSideBends && stepsSinceTurn >= randInt(2, 4) && Math.abs(targetRow - row) > 3 && Math.random() < 0.55) {
        addSideBend('vertical', step, targetRow)
        stepsSinceTurn = 0
      }
    }
  }

  // 短折线会先预演，再确认不撞旧道路、不贴太近，避免路线交叉或挤碎建塔空地。
  function addSideBend(axis, step, target) {
    const sideStep = Math.random() > 0.5 ? 1 : -1
    const depth = randInt(1, 3)
    const forward = randInt(1, 3)
    const maxCol = GRID_COLS - 1
    const maxRow = GRID_ROWS - 1

    if (axis === 'horizontal') {
      let turn = sideStep
      if (row + turn * depth < 0 || row + turn * depth > maxRow) turn *= -1
      if (row + turn * depth < 0 || row + turn * depth > maxRow) return

      const bendCells = []
      let testCol = col
      let testRow = row
      for (let i = 0; i < depth; i += 1) {
        testRow += turn
        bendCells.push({ col: testCol, row: testRow })
      }
      for (let i = 0; i < forward && testCol !== target; i += 1) {
        testCol += step
        bendCells.push({ col: testCol, row: testRow })
      }
      for (let i = 0; i < depth; i += 1) {
        testRow -= turn
        bendCells.push({ col: testCol, row: testRow })
      }
      if (bendCells.some((cell) => !canUseCell(cell.col, cell.row) || hasNearbyOldRoute(cell.col, cell.row))) return
      bendCells.forEach((cell) => addCell(cell.col, cell.row))
    } else {
      let turn = sideStep
      if (col + turn * depth < 0 || col + turn * depth > maxCol) turn *= -1
      if (col + turn * depth < 0 || col + turn * depth > maxCol) return

      const bendCells = []
      let testCol = col
      let testRow = row
      for (let i = 0; i < depth; i += 1) {
        testCol += turn
        bendCells.push({ col: testCol, row: testRow })
      }
      for (let i = 0; i < forward && testRow !== target; i += 1) {
        testRow += step
        bendCells.push({ col: testCol, row: testRow })
      }
      for (let i = 0; i < depth; i += 1) {
        testCol -= turn
        bendCells.push({ col: testCol, row: testRow })
      }
      if (bendCells.some((cell) => !canUseCell(cell.col, cell.row) || hasNearbyOldRoute(cell.col, cell.row))) return
      bendCells.forEach((cell) => addCell(cell.col, cell.row))
    }
  }

  const horizontalRoute = Math.random() > 0.5
  if (horizontalRoute) {
    const lanes = makeLanes(randInt(4, 5), GRID_ROWS, laneGap)
    if (Math.random() > 0.5) lanes.reverse()
    col = Math.random() > 0.5 ? 0 : GRID_COLS - 1
    row = lanes[0]
    let targetCol = col === 0 ? GRID_COLS - 1 : 0

    addCell(col, row)
    for (let i = 0; i < lanes.length; i += 1) {
      walkToCol(targetCol)
      if (i < lanes.length - 1) {
        walkToRow(lanes[i + 1])
        targetCol = targetCol === 0 ? GRID_COLS - 1 : 0
      }
    }
  } else {
    const lanes = makeLanes(randInt(4, 5), GRID_COLS, laneGap)
    if (Math.random() > 0.5) lanes.reverse()
    col = lanes[0]
    row = Math.random() > 0.5 ? 0 : GRID_ROWS - 1
    let targetRow = row === 0 ? GRID_ROWS - 1 : 0

    addCell(col, row)
    for (let i = 0; i < lanes.length; i += 1) {
      walkToRow(targetRow)
      if (i < lanes.length - 1) {
        walkToCol(lanes[i + 1])
        targetRow = targetRow === 0 ? GRID_ROWS - 1 : 0
      }
    }
  }

  return { blocked, pathCells, waypoints: [] }
}

// 防御性校验：路线不允许重复经过同一格，否则视觉上会形成交叉或重叠。
function hasRepeatedPathCells(pathCells) {
  const visited = {}
  for (let i = 0; i < pathCells.length; i += 1) {
    const key = `${pathCells[i].col},${pathCells[i].row}`
    if (visited[key]) return true
    visited[key] = true
  }
  return false
}

function refreshMapMetrics() {
  if (!map || !layout.cell) return
  map.waypoints = map.pathCells.map((cell) => cellCenter(cell.col, cell.row))
  towers.forEach((tower) => {
    const center = towerCenter(tower.col, tower.row)
    tower.x = center.x
    tower.y = center.y
  })
}

function cellCenter(col, row) {
  return {
    x: col * layout.cell + layout.cell / 2,
    y: row * layout.cell + layout.cell / 2
  }
}

function towerCenter(col, row) {
  return {
    x: (col + TOWER_SIZE / 2) * layout.cell,
    y: (row + TOWER_SIZE / 2) * layout.cell
  }
}

// 下一轮只能在空闲状态，或“本轮敌人已全部出现但尚未清完”时开启。
function canStartNextWave() {
  if (state.gameOver) return false
  if (!state.running) return true
  return spawnQueue.length === 0
}

// 开启一轮敌人：提前开启时追加队列，不清空场上敌人，并按剩余压力发放奖励。
function startWave() {
  if (!canStartNextWave()) return
  const nextWave = state.wave + 1
  const count = 7 + nextWave * 3
  const hpMultiplier = 1 + (nextWave - 1) * 0.34
  const queuedBefore = spawnQueue.length
  const earlyReward = estimateEarlyWaveReward(nextWave)
  const nextQueue = Array.from({ length: count }, (_, index) => createEnemyConfig(nextWave, index, hpMultiplier))
  if (nextWave % 3 === 0) {
    nextQueue.splice(Math.max(1, Math.floor(count * 0.45)), 0, createBossConfig(nextWave, 'normal', hpMultiplier))
  }
  if (nextWave % specialBossTypes.anna.every === 0) {
    nextQueue.splice(Math.max(1, Math.floor(count * 0.58)), 0, createBossConfig(nextWave, 'anna', hpMultiplier))
  }
  if (nextWave % specialBossTypes.family.every === 0) {
    nextQueue.splice(Math.max(1, Math.floor(count * 0.72)), 0, createBossConfig(nextWave, 'family', hpMultiplier))
  }
  spawnQueue = spawnQueue.concat(nextQueue)
  if (!state.running || queuedBefore === 0) spawnTimer = 0
  state.wave = nextWave
  state.running = true
  if (earlyReward.gold > 0) {
    state.gold += earlyReward.gold
    state.earnedGold += earlyReward.gold
  }
  const rewardText = earlyReward.gold > 0 ? `，提前 ${earlyReward.seconds}s 奖励 ${earlyReward.gold} 金` : ''
  state.message = nextQueue.some((enemy) => enemy.boss)
    ? `第 ${nextWave} 轮 Boss 加入战场${rewardText}`
    : `第 ${nextWave} 轮敌人加入战场${rewardText}`
  buildButtons()
}

function createBossConfig(wave, kind, hpMultiplier) {
  if (kind === 'anna') {
    const type = specialBossTypes.anna
    return {
      type: type.id,
      name: type.name,
      image: type.image,
      color: type.color,
      mark: type.mark,
      hp: Math.round((340 + wave * 112) * hpMultiplier * type.hpScale),
      speed: 0.023 + wave * 0.0009,
      reward: Math.round((54 + wave * 6) * type.rewardScale),
      boss: true,
      bossKind: 'anna',
      radiusScale: type.radius,
      attackScale: type.attack,
      blockImmune: false
    }
  }
  if (kind === 'family') {
    const type = specialBossTypes.family
    return {
      type: type.id,
      name: type.name,
      image: type.image,
      color: type.color,
      mark: type.mark,
      hp: Math.round((430 + wave * 135) * hpMultiplier * type.hpScale),
      speed: 0.02 + wave * 0.00075,
      reward: Math.round((70 + wave * 8) * type.rewardScale),
      boss: true,
      bossKind: 'family',
      radiusScale: type.radius,
      attackScale: type.attack,
      blockImmune: false
    }
  }
  const type = enemyTypes.boss
  return {
    type: 'boss',
    name: type.name,
    image: type.image,
    color: type.color,
    mark: type.mark,
    hp: Math.round((260 + wave * 90) * hpMultiplier),
    speed: 0.026 + wave * 0.0012,
    reward: 42 + wave * 5,
    boss: true,
    bossKind: 'normal',
    radiusScale: type.radius,
    attackScale: type.attack,
    blockImmune: false
  }
}

// 提前奖励按“剩余刷怪时间”和“场上敌人预计走完全程时间”取较大值估算，并设置上限。
function estimateEarlyWaveReward(nextWave) {
  if (!state.running || (spawnQueue.length === 0 && enemies.length === 0)) return { gold: 0, seconds: 0 }

  const spawnMs = Math.max(0, spawnTimer) + spawnQueue.length * currentSpawnInterval(state.wave)
  let travelMs = 0
  enemies.forEach((enemy) => {
    travelMs = Math.max(travelMs, estimateEnemyTravelMs(enemy))
  })

  const seconds = Math.max(1, Math.ceil(Math.max(spawnMs, travelMs) / 1000))
  const rawGold = Math.floor(seconds / 3) + nextWave * 2
  const maxGold = 18 + nextWave * 8
  return {
    gold: Math.max(3, Math.min(maxGold, rawGold)),
    seconds
  }
}

function currentSpawnInterval(wave) {
  return Math.max(380, 980 - wave * 35)
}

// 用路径剩余格数近似估算敌人走到终点的时间，足够用于提前奖励，不参与真实移动。
function estimateEnemyTravelMs(enemy) {
  if (!map || !map.waypoints || !map.waypoints.length) return 0
  const target = map.waypoints[enemy.waypoint]
  const currentSegment = target ? distance(enemy, target) : 0
  const remainingSegments = Math.max(0, map.waypoints.length - enemy.waypoint - 1)
  const remainingDistance = currentSegment + remainingSegments * layout.cell
  const speed = Math.max(0.01, enemy.speed * (enemy.slowFactor || 1))
  return remainingDistance / speed
}

// 按轮次和敌人类型倍率生成单个敌人的实际数值。
function createEnemyConfig(wave, index, hpMultiplier) {
  const type = pickEnemyType(wave, index)
  const baseHp = 48 + wave * 18 + Math.floor(index / 4) * (8 + wave * 2)
  const baseSpeed = 0.035 + wave * 0.002
  const baseReward = 8 + Math.floor(wave / 2)
  return {
    type: type.id,
    name: type.name,
    image: type.image,
    color: type.color,
    mark: type.mark,
    hp: Math.round(baseHp * hpMultiplier * type.hp),
    speed: +(baseSpeed * type.speed).toFixed(4),
    reward: Math.max(4, Math.round(baseReward * type.reward)),
    boss: false,
    radiusScale: type.radius,
    attackScale: type.attack,
    blockImmune: type.blockImmune
  }
}

// 敌人类型随轮次逐步解锁，并混入固定节奏的快兵、重甲和幽影兵。
function pickEnemyType(wave, index) {
  const available = enemyTypeOrder.filter((id) => (
    id === 'grunt' ||
    (id === 'runner' && wave >= 2) ||
    (id === 'brute' && wave >= 3) ||
    (id === 'shade' && wave >= 4)
  ))
  if (index > 0 && index % 7 === 0 && available.indexOf('brute') !== -1) return enemyTypes.brute
  if (index > 0 && index % 5 === 0 && available.indexOf('runner') !== -1) return enemyTypes.runner
  if (index > 0 && index % 9 === 0 && available.indexOf('shade') !== -1) return enemyTypes.shade
  const roll = Math.random()
  if (available.indexOf('shade') !== -1 && roll < 0.16) return enemyTypes.shade
  if (available.indexOf('runner') !== -1 && roll < 0.42) return enemyTypes.runner
  if (available.indexOf('brute') !== -1 && roll < 0.64) return enemyTypes.brute
  return enemyTypes.grunt
}

// 随机地图用于重开当前布局；战斗中不允许切图，避免路线和敌人状态断开。
function rerollMap() {
  if (state.running || state.gameOver) return
  map = createMap()
  towers = []
  enemies = []
  projectiles = []
  soldiers = []
  effects = []
  spawnQueue = []
  state.selectedTowerId = null
  state.pendingBuildCell = null
  state.message = '新地图已生成，金币和生命保留'
  refreshMapMetrics()
}

// 建塔入口：所有塔占 2x2，必须先通过 canPlaceTower 检查道路和已有塔占用。
function tryBuildTower(col, row, towerTypeId) {
  const type = towerTypes[towerTypeId]
  if (!type) return
  const check = canPlaceTower(col, row)
  if (!check.ok) {
    state.message = check.message
    return
  }
  if (state.gold < type.cost) {
    state.message = `金币不足，需要 ${type.cost}`
    return
  }

  const center = towerCenter(col, row)
  const tower = {
    id: `${Date.now()}-${Math.random()}`,
    type: type.id,
    name: type.name,
    col,
    row,
    size: TOWER_SIZE,
    x: center.x,
    y: center.y,
    level: 1,
    range: type.range,
    damage: type.damage,
    cooldown: type.cooldown,
    fireTimer: 0,
    upgradeCost: Math.round(type.cost * 0.72),
    investedGold: type.cost
  }
  towers.push(tower)
  state.gold -= type.cost
  state.spentGold += type.cost
  state.towersBuilt += 1
  state.selectedTowerId = tower.id
  state.selectedTowerType = type.id
  state.pendingBuildCell = null
  state.message = `${type.name} 已建造`
  createRingEffect(tower.x, tower.y, type.color, layout.cell * 0.9)
}

function canPlaceTower(col, row) {
  if (col < 0 || row < 0 || col + TOWER_SIZE > GRID_COLS || row + TOWER_SIZE > GRID_ROWS) {
    return { ok: false, message: '塔需要 2x2 空地，不能超出地图' }
  }
  for (let y = row; y < row + TOWER_SIZE; y += 1) {
    for (let x = col; x < col + TOWER_SIZE; x += 1) {
      if (map.blocked[`${x},${y}`]) return { ok: false, message: '2x2 范围内有道路，不能建塔' }
      if (findTowerAt(x, y)) return { ok: false, message: '2x2 范围内已有塔' }
    }
  }
  return { ok: true }
}

function findTowerAt(col, row) {
  return towers.find((tower) => (
    col >= tower.col &&
    col < tower.col + TOWER_SIZE &&
    row >= tower.row &&
    row < tower.row + TOWER_SIZE
  ))
}

// 选中塔升级时直接同步兵营士兵属性，避免升级后士兵状态和塔等级脱节。
function upgradeSelectedTower() {
  const tower = towers.find((item) => item.id === state.selectedTowerId)
  if (!tower || state.gold < tower.upgradeCost) return
  state.pendingBuildCell = null
  const cost = tower.upgradeCost
  tower.level += 1
  tower.damage = Math.round(tower.damage * 1.38)
  tower.range = +(tower.range + 0.22).toFixed(2)
  tower.cooldown = Math.max(260, Math.round(tower.cooldown * 0.9))
  tower.upgradeCost = Math.round(tower.upgradeCost * 1.55)
  tower.investedGold = (tower.investedGold || towerTypes[tower.type].cost) + cost
  tower.recoilTimer = 180
  state.gold -= cost
  state.spentGold += cost
  syncBarracksSoldiers(tower)
  createRingEffect(tower.x, tower.y, towerTypes[tower.type].color, layout.cell * 1.5)
}

// 出售塔会移除兵营士兵支援，并返还该塔总投入金币的 60%。
function sellSelectedTower() {
  const index = towers.findIndex((item) => item.id === state.selectedTowerId)
  if (index < 0) return
  state.pendingBuildCell = null

  const tower = towers[index]
  const refund = Math.max(1, Math.round((tower.investedGold || towerTypes[tower.type].cost) * 0.6))
  removeTowerSupport(tower)
  towers.splice(index, 1)
  projectiles = projectiles.filter((projectile) => projectile.target && enemies.includes(projectile.target))
  state.gold += refund
  state.selectedTowerId = null
  state.message = `${tower.name} 已出售，返还 ${refund} 金币`
  createRingEffect(tower.x, tower.y, '#facc15', layout.cell * 1.4)
}

function toggleGameSpeed() {
  if (state.gameOver) return
  state.gameSpeed = state.gameSpeed === 1 ? 2 : 1
  state.message = `当前速度：${state.gameSpeed}x`
  buildButtons()
}

function castFreezeSkill() {
  if (state.gameOver || state.freezeCooldown > 0) return
  state.freezeTimer = 4200
  state.freezeCooldown = 18000
  enemies.forEach((enemy) => {
    enemy.freezeTimer = Math.max(enemy.freezeTimer || 0, state.freezeTimer)
  })
  state.message = '冻结全场，敌人暂时无法移动'
  effects.push({
    type: 'screen',
    x: layout.boardW / 2,
    y: layout.boardH / 2,
    age: 0,
    life: 520,
    radius: Math.max(layout.boardW, layout.boardH),
    color: '#7dd3fc'
  })
}

function castPowerSkill() {
  if (state.gameOver || state.powerCooldown > 0) return
  state.powerTimer = 6200
  state.powerCooldown = 22000
  state.message = '强攻启动，攻击力提升 50%'
  effects.push({
    type: 'screen',
    x: layout.boardW / 2,
    y: layout.boardH / 2,
    age: 0,
    life: 520,
    radius: Math.max(layout.boardW, layout.boardH),
    color: '#facc15'
  })
}

function updateSkills(dt) {
  state.freezeCooldown = Math.max(0, state.freezeCooldown - dt)
  state.freezeTimer = Math.max(0, state.freezeTimer - dt)
  state.stasisTimer = Math.max(0, state.stasisTimer - dt)
  state.powerCooldown = Math.max(0, state.powerCooldown - dt)
  state.powerTimer = Math.max(0, state.powerTimer - dt)
}

function isUnitStasisActive() {
  return state.stasisTimer > 0
}

function attackMultiplier() {
  return state.powerTimer > 0 ? 1.5 : 1
}

// 兵营被出售时，需要释放它的士兵正在阻挡的敌人，避免敌人永久停住。
function removeTowerSupport(tower) {
  if (tower.type !== 'barracks') return
  for (let i = soldiers.length - 1; i >= 0; i -= 1) {
    const soldier = soldiers[i]
    if (soldier.towerId !== tower.id) continue
    releaseSoldierBlock(soldier)
    soldiers.splice(i, 1)
  }
}

// 主更新循环：Family Boss 的冻结只暂停防守单位，敌人和已飞出的弹体继续推进。
function update(dt) {
  if (state.gameOver) {
    updateEffects(dt)
    return
  }
  if (bossCurtain) {
    updateBossCurtain(dt)
    updateEffects(dt)
    return
  }
  updateSkills(dt)
  if (state.running) updateSpawns(dt)
  updateEnemies(dt)
  if (state.gameOver) {
    updateEffects(dt)
    return
  }
  if (!isUnitStasisActive()) {
    updateSoldiers(dt)
    updateTowers(dt)
  }
  updateProjectiles(dt)
  updateEffects(dt)

  if (state.running && spawnQueue.length === 0 && enemies.length === 0) {
    completeWaveIfCleared()
  }
}

// 从 spawnQueue 中按间隔生成敌人实例。敌人的类型颜色、倍率和阻挡免疫都来自配置。
function updateSpawns(dt) {
  spawnTimer -= dt
  if (spawnTimer > 0 || spawnQueue.length === 0) return
  const config = spawnQueue.shift()
  const start = map.waypoints[0]
  enemies.push({
    id: `${Date.now()}-${Math.random()}`,
    type: config.type,
    name: config.name,
    image: config.image,
    color: config.color,
    mark: config.mark,
    x: start.x,
    y: start.y,
    hp: config.hp,
    maxHp: config.hp,
    speed: config.speed,
    reward: config.reward,
    boss: !!config.boss,
    bossKind: config.bossKind || null,
    specialTriggered: false,
    specialActionTimer: 0,
    pendingHealRatio: 0,
    radiusScale: config.radiusScale || 1,
    attackScale: config.attackScale || 1,
    blockImmune: !!config.blockImmune,
    waypoint: 1,
    slowTimer: 0,
    slowFactor: 1,
    blockedBy: null,
    moveAngle: 0,
    movePulse: 0,
    attackTimer: 0,
    attackDamage: Math.round(((config.boss ? 12 : 5) + Math.floor(state.wave * (config.boss ? 2.4 : 1.6))) * (config.attackScale || 1)),
    hurtTimer: 0,
    age: 0,
    wobble: Math.random() * TWO_PI
  })
  createRingEffect(start.x, start.y, config.color || '#fbbf24', layout.cell * 0.32)
  spawnTimer = currentSpawnInterval(state.wave)
}

// 敌人移动沿 map.waypoints 推进；被士兵阻挡时停止移动并反击士兵。
function updateEnemies(dt) {
  for (let i = enemies.length - 1; i >= 0; i -= 1) {
    const enemy = enemies[i]
    if (enemy.hp <= 0) {
      enemies.splice(i, 1)
      releaseEnemyBlock(enemy)
      if (startBossCurtain(enemy)) continue
      createDeathBurst(enemy)
      settleEnemyKill(enemy)
      continue
    }

    enemy.age += dt
    enemy.hurtTimer = Math.max(0, enemy.hurtTimer - dt)
    updateBossSpecialAction(enemy, dt)
    enemy.freezeTimer = Math.max(0, (enemy.freezeTimer || 0) - dt)
    if (enemy.slowTimer > 0) enemy.slowTimer -= dt
    else enemy.slowFactor = 1
    if (enemy.specialActionTimer > 0) continue
    if (enemy.freezeTimer > 0 || state.freezeTimer > 0) continue
    if (isEnemyBlocked(enemy)) {
      updateBlockedEnemyAttack(enemy, dt)
      continue
    }

    const target = map.waypoints[enemy.waypoint]
    if (!target) {
      enemies.splice(i, 1)
      releaseEnemyBlock(enemy)
      state.lives = Math.max(0, state.lives - 1)
      state.escaped += 1
      createRingEffect(enemy.x, enemy.y, '#ef4444', layout.cell * 0.38)
      if (state.lives <= 0) finishGame()
      else state.message = '有敌人突破了防线'
      continue
    }

    const dist = distance(enemy, target)
    const step = enemy.speed * enemy.slowFactor * dt
    enemy.moveAngle = Math.atan2(target.y - enemy.y, target.x - enemy.x)
    if (dist <= step) {
      enemy.x = target.x
      enemy.y = target.y
      enemy.waypoint += 1
    } else {
      enemy.x += ((target.x - enemy.x) / dist) * step
      enemy.y += ((target.y - enemy.y) / dist) * step
      enemy.movePulse += dt * enemy.speed * 0.16
    }
  }
}

function updateTowers(dt) {
  towers.forEach((tower) => {
    tower.fireTimer -= dt
    if (tower.type === 'barracks' && tower.respawnTimers) {
      tower.respawnTimers = tower.respawnTimers.map((timer) => timer - dt).filter((timer) => timer > 0)
    }
    tower.recoilTimer = Math.max(0, (tower.recoilTimer || 0) - dt)
    if (tower.fireTimer > 0) return
    if (tower.type === 'barracks') {
      updateBarracks(tower)
      return
    }
    const target = findEnemyInRange(tower, tower.range * layout.cell)
    if (!target) return

    tower.fireTimer = tower.cooldown
    tower.recoilTimer = tower.type === 'rocket' ? 210 : 150
    const type = towerTypes[tower.type]
    const angle = Math.atan2(target.y - tower.y, target.x - tower.x)
    projectiles.push({
      x: tower.x,
      y: tower.y,
      prevX: tower.x,
      prevY: tower.y,
      target,
      type: tower.type,
      damage: Math.round(tower.damage * attackMultiplier()),
      speed: tower.type === 'rocket' ? 0.32 : tower.type === 'magic' ? 0.62 : 0.54,
      splash: type.splash ? type.splash * layout.cell : 0,
      slow: type.slow || 0,
      color: type.color,
      angle,
      age: 0
    })
    const muzzleDistance = layout.cell * (tower.type === 'rocket' ? 0.8 : 0.55)
    effects.push({
      type: tower.type === 'magic' ? 'beam' : 'muzzle',
      x: tower.x + Math.cos(angle) * muzzleDistance,
      y: tower.y + Math.sin(angle) * muzzleDistance,
      fromX: tower.x,
      fromY: tower.y,
      toX: target.x,
      toY: target.y,
      angle,
      age: 0,
      life: tower.type === 'magic' ? 190 : 170,
      radius: layout.cell * (tower.type === 'rocket' ? 0.32 : 0.22),
      color: type.color
    })
  })
}

// 兵营不发射弹体，而是维持一定数量的士兵；死亡士兵用 respawnTimers 延迟补充。
function updateBarracks(tower) {
  tower.fireTimer = tower.cooldown
  const maxSoldiers = Math.min(2 + tower.level, 5)
  const owned = soldiers.filter((soldier) => soldier.towerId === tower.id)
  owned.forEach((soldier) => syncSoldier(soldier, tower))
  if (owned.length >= maxSoldiers) return

  const pendingRespawns = tower.respawnTimers || []
  if (owned.length + pendingRespawns.length >= maxSoldiers) return
  spawnBarracksSoldier(tower)
}

// 士兵出生在兵营附近最近的道路点，并围绕这个点做有限巡逻和阻挡。
function spawnBarracksSoldier(tower) {
  const point = nearestPathInfo(tower)
  const stats = barracksSoldierStats(tower)
  soldiers.push({
    id: `${tower.id}-soldier-${Date.now()}-${Math.random()}`,
    towerId: tower.id,
    x: point.x,
    y: point.y,
    guardX: point.x,
    guardY: point.y,
    pathIndex: point.index,
    patrolDir: 1,
    damage: stats.damage,
    hp: stats.hp,
    maxHp: stats.hp,
    guardRadius: stats.guardRadius,
    blockDistance: stats.blockDistance,
    moveSpeed: stats.moveSpeed,
    spawnTimer: 360,
    attackTimer: 0,
    attackCooldown: stats.attackCooldown,
    blockingEnemyId: null
  })
}

// 士兵优先追最近防区内的可阻挡敌人；幽影兵不会被设为阻挡目标。
function updateSoldiers(dt) {
  for (let i = soldiers.length - 1; i >= 0; i -= 1) {
    const soldier = soldiers[i]
    if (soldier.hp <= 0) {
      removeDeadSoldier(soldier, i)
      continue
    }
    soldier.attackTimer -= dt
    soldier.spawnTimer = Math.max(0, (soldier.spawnTimer || 0) - dt)
    soldier.swingTimer = Math.max(0, (soldier.swingTimer || 0) - dt)
    const target = resolveSoldierTarget(soldier)
    if (target) {
      const reached = moveToward(soldier, target, soldier.moveSpeed * dt, soldier.blockDistance)
      if (reached && !target.blockImmune) {
        target.blockedBy = soldier.id
        soldier.blockingEnemyId = target.id
      }
    } else {
      releaseSoldierBlock(soldier)
      patrolSoldier(soldier, dt)
    }
    if (!target || target.blockedBy !== soldier.id || soldier.attackTimer > 0) continue
    damageEnemy(target, Math.round(soldier.damage * attackMultiplier()), '#bbf7d0')
    soldier.swingTimer = 180
    soldier.attackTimer = soldier.attackCooldown
    effects.push({ type: 'slash', x: target.x, y: target.y, age: 0, life: 180, color: '#bbf7d0', angle: Math.random() * Math.PI })
  }
}

// 弹体只保存目标引用；目标死亡或移除时弹体自动消失。
function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i -= 1) {
    const p = projectiles[i]
    if (!enemies.includes(p.target)) {
      projectiles.splice(i, 1)
      continue
    }
    const dist = distance(p, p.target)
    const step = p.speed * dt
    if (dist <= step) {
      hitEnemy(p)
      projectiles.splice(i, 1)
      continue
    }
    p.prevX = p.x
    p.prevY = p.y
    p.x += ((p.target.x - p.x) / dist) * step
    p.y += ((p.target.y - p.y) / dist) * step
    p.angle = Math.atan2(p.target.y - p.y, p.target.x - p.x)
    p.age += dt
  }
}

function hitEnemy(p) {
  if (p.splash) {
    enemies.forEach((enemy) => {
      if (distance(enemy, p.target) <= p.splash) damageEnemy(enemy, p.damage, p.color)
    })
    effects.push({ type: 'explosion', x: p.target.x, y: p.target.y, age: 0, life: 360, radius: p.splash, color: p.color })
    effects.push({ type: 'shockwave', x: p.target.x, y: p.target.y, age: 0, life: 420, radius: p.splash * 0.25, endRadius: p.splash * 1.15, color: '#fed7aa' })
    for (let i = 0; i < 10; i += 1) {
      const angle = Math.random() * TWO_PI
      const speed = 0.035 + Math.random() * 0.08
      effects.push({
        type: 'spark',
        x: p.target.x,
        y: p.target.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        age: 0,
        life: 260 + Math.random() * 220,
        radius: layout.cell * (0.04 + Math.random() * 0.06),
        color: Math.random() > 0.45 ? '#fb923c' : '#fde68a'
      })
    }
  } else {
    damageEnemy(p.target, p.damage, p.color)
  }
  if (p.slow) {
    p.target.slowFactor = p.slow
    p.target.slowTimer = 1100
    createRingEffect(p.target.x, p.target.y, '#c4b5fd', layout.cell * 0.72)
  }
}

function damageEnemy(enemy, damage, color) {
  if (enemy.specialActionTimer > 0) return
  enemy.hp -= damage
  enemy.hurtTimer = 140
  effects.push({ type: 'hit', x: enemy.x, y: enemy.y, age: 0, life: 220, radius: layout.cell * 0.2, color })
  triggerBossSpecialIfNeeded(enemy)
}

function triggerBossSpecialIfNeeded(enemy) {
  if (!enemy.bossKind || enemy.bossKind === 'normal' || enemy.specialTriggered) return
  if (enemy.hp > enemy.maxHp * 0.5) return

  enemy.specialTriggered = true
  releaseEnemyBlock(enemy)
  enemy.blockedBy = null

  if (enemy.bossKind === 'anna') {
    enemy.hp = Math.max(1, enemy.hp)
    enemy.specialActionTimer = 2600
    enemy.pendingHealRatio = 0.78
    enemy.hurtTimer = 0
    state.message = 'Anna Boss 原地大哭，马上回血'
    effects.push({ type: 'cry', x: enemy.x, y: enemy.y, age: 0, life: 2600, radius: layout.cell * 1.15, color: enemy.color })
    createRingEffect(enemy.x, enemy.y, '#f9a8d4', layout.cell * 1.25)
    return
  }

  if (enemy.bossKind === 'family') {
    enemy.hp = enemy.maxHp
    state.stasisTimer = 10000 * state.gameSpeed
    state.message = 'Family Boss 释放全屏冻结，塔和士兵暂停 10 秒'
    effects.push({
      type: 'screen',
      x: layout.boardW / 2,
      y: layout.boardH / 2,
      age: 0,
      life: 900,
      radius: Math.max(layout.boardW, layout.boardH),
      color: '#7dd3fc'
    })
    effects.push({ type: 'shockwave', x: enemy.x, y: enemy.y, age: 0, life: 900, radius: layout.cell * 0.4, endRadius: layout.cell * 4.2, color: '#bae6fd' })
  }
}

function updateBossSpecialAction(enemy, dt) {
  if (!enemy.specialActionTimer) return
  enemy.specialActionTimer = Math.max(0, enemy.specialActionTimer - dt)
  if (enemy.specialActionTimer > 0 || !enemy.pendingHealRatio) return
  enemy.hp = Math.max(enemy.hp, Math.round(enemy.maxHp * enemy.pendingHealRatio))
  enemy.pendingHealRatio = 0
  enemy.hurtTimer = 0
  state.message = 'Anna Boss 哭完后恢复了大量血量'
  effects.push({ type: 'heal', x: enemy.x, y: enemy.y, age: 0, life: 620, radius: layout.cell * 0.55, endRadius: layout.cell * 1.75, color: '#86efac' })
}

function updateEffects(dt) {
  for (let i = effects.length - 1; i >= 0; i -= 1) {
    const e = effects[i]
    e.age += dt
    if (e.vx) {
      e.x += e.vx * dt
      e.y += e.vy * dt
    }
    if (e.age >= e.life) effects.splice(i, 1)
  }
}

function startBossCurtain(enemy) {
  if (enemy.bossKind !== 'anna' && enemy.bossKind !== 'family') return false
  const speedScale = Math.max(1, state.gameSpeed)
  const message = enemy.bossKind === 'anna'
    ? '啊，到时间了，我该回去做作业了'
    : '全家都要健健康康！'
  bossCurtain = {
    kind: enemy.bossKind,
    image: enemy.image,
    color: enemy.color || '#fbbf24',
    text: message,
    x: enemy.x,
    y: enemy.y,
    age: 0,
    growTime: 1100 * speedScale,
    marqueeTime: 4300 * speedScale,
    fadeTime: 650 * speedScale,
    reward: enemy.reward,
    enemy
  }
  projectiles = projectiles.filter((projectile) => projectile.target !== enemy)
  state.message = enemy.bossKind === 'anna' ? 'Anna Boss 退场演出' : 'Family Boss 退场演出'
  return true
}

function updateBossCurtain(dt) {
  if (!bossCurtain) return
  bossCurtain.age += dt
  const total = bossCurtain.growTime + bossCurtain.marqueeTime + bossCurtain.fadeTime
  if (bossCurtain.age < total) return

  const enemy = bossCurtain.enemy
  createDeathBurst({ ...enemy, x: layout.boardW / 2, y: layout.boardH / 2 })
  settleEnemyKill(enemy)
  bossCurtain = null
  completeWaveIfCleared()
}

function settleEnemyKill(enemy) {
  state.gold += enemy.reward
  state.earnedGold += enemy.reward
  state.kills += 1
}

function completeWaveIfCleared() {
  if (!state.running || spawnQueue.length > 0 || enemies.length > 0 || bossCurtain) return
  const bonus = 24 + state.wave * 4
  state.running = false
  state.gold += bonus
  state.earnedGold += bonus
  state.message = `第 ${state.wave} 轮清理完毕`
  buildButtons()
}

// 兵营士兵的生命、巡逻半径、攻击间隔都随塔等级增长。
function barracksSoldierStats(tower) {
  return {
    damage: Math.max(2, Math.round(tower.damage * 0.48)),
    hp: 46 + tower.level * 18,
    guardRadius: (2.05 + tower.level * 0.24) * layout.cell,
    blockDistance: Math.max(6, layout.cell * 0.58),
    moveSpeed: 0.064 + tower.level * 0.006,
    attackCooldown: Math.max(520, 760 - tower.level * 35),
    respawnDelay: Math.max(2600, 5200 - tower.level * 260)
  }
}

function syncBarracksSoldiers(tower) {
  soldiers.forEach((soldier) => {
    if (soldier.towerId === tower.id) syncSoldier(soldier, tower)
  })
}

function syncSoldier(soldier, tower) {
  const stats = barracksSoldierStats(tower)
  soldier.damage = stats.damage
  soldier.maxHp = stats.hp
  soldier.hp = Math.min(soldier.hp || stats.hp, soldier.maxHp)
  soldier.guardRadius = stats.guardRadius
  soldier.blockDistance = stats.blockDistance
  soldier.moveSpeed = stats.moveSpeed
  soldier.attackCooldown = stats.attackCooldown
}

function updateBlockedEnemyAttack(enemy, dt) {
  const soldier = soldiers.find((item) => item.id === enemy.blockedBy)
  if (!soldier) return
  enemy.attackTimer -= dt
  if (enemy.attackTimer > 0) return

  soldier.hp -= enemy.attackDamage
  soldier.swingTimer = 160
  enemy.attackTimer = Math.max(620, 1050 - state.wave * 18)
  effects.push({
    type: 'hit',
    x: soldier.x,
    y: soldier.y,
    age: 0,
    life: 180,
    radius: layout.cell * 0.18,
    color: '#fb7185'
  })
}

// 士兵死亡后不立刻重生，而是在所属兵营上登记一个复活计时器。
function removeDeadSoldier(soldier, index) {
  releaseSoldierBlock(soldier)
  soldiers.splice(index, 1)
  const tower = towers.find((item) => item.id === soldier.towerId)
  if (tower) {
    const stats = barracksSoldierStats(tower)
    tower.respawnTimers = tower.respawnTimers || []
    tower.respawnTimers.push(stats.respawnDelay)
  }
  effects.push({
    type: 'soldierDeath',
    x: soldier.x,
    y: soldier.y,
    age: 0,
    life: 360,
    radius: layout.cell * 0.34,
    image: soldierIconPath,
    color: '#86efac'
  })
  createRingEffect(soldier.x, soldier.y, '#fb7185', layout.cell * 0.42)
}

function resolveSoldierTarget(soldier) {
  const current = enemies.find((enemy) => enemy.id === soldier.blockingEnemyId)
  if (current && current.hp > 0 && !current.blockImmune && isEnemyInSoldierZone(soldier, current)) return current
  releaseSoldierBlock(soldier)
  return findEnemyForSoldier(soldier)
}

// 选择路径进度更靠前的敌人，避免士兵去追身后的低威胁目标。
function findEnemyForSoldier(soldier) {
  let best = null
  let progress = -1
  enemies.forEach((enemy) => {
    if (enemy.blockImmune) return
    if (enemy.blockedBy && enemy.blockedBy !== soldier.id) return
    if (!isEnemyInSoldierZone(soldier, enemy)) return
    const p = enemy.waypoint * 10000 + enemy.x + enemy.y
    if (p > progress) {
      best = enemy
      progress = p
    }
  })
  return best
}

function isEnemyInSoldierZone(soldier, enemy) {
  return distance({ x: soldier.guardX, y: soldier.guardY }, enemy) <= soldier.guardRadius
}

// 判断敌人是否仍被当前士兵有效阻挡；幽影兵会主动释放阻挡状态。
function isEnemyBlocked(enemy) {
  if (enemy.blockImmune) {
    releaseEnemyBlock(enemy)
    return false
  }
  if (!enemy.blockedBy) return false
  const soldier = soldiers.find((item) => item.id === enemy.blockedBy)
  if (!soldier || soldier.hp <= 0 || soldier.blockingEnemyId !== enemy.id || !isEnemyInSoldierZone(soldier, enemy)) {
    enemy.blockedBy = null
    if (soldier && soldier.blockingEnemyId === enemy.id) soldier.blockingEnemyId = null
    return false
  }
  const close = distance(soldier, enemy) <= soldier.blockDistance + layout.cell * 0.2
  if (!close) {
    enemy.blockedBy = null
    soldier.blockingEnemyId = null
  }
  return close
}

function releaseSoldierBlock(soldier) {
  if (!soldier.blockingEnemyId) return
  const enemy = enemies.find((item) => item.id === soldier.blockingEnemyId)
  if (enemy && enemy.blockedBy === soldier.id) enemy.blockedBy = null
  soldier.blockingEnemyId = null
}

function releaseEnemyBlock(enemy) {
  if (!enemy.blockedBy) return
  const soldier = soldiers.find((item) => item.id === enemy.blockedBy)
  if (soldier && soldier.blockingEnemyId === enemy.id) soldier.blockingEnemyId = null
  enemy.blockedBy = null
}

function patrolSoldier(soldier, dt) {
  const target = map.waypoints[soldier.pathIndex] || map.waypoints[0]
  const reached = moveToward(soldier, target, soldier.moveSpeed * 0.72 * dt, layout.cell * 0.08)
  if (!reached) return
  const forward = soldier.pathIndex + soldier.patrolDir
  const backward = soldier.pathIndex - soldier.patrolDir
  if (canSoldierPatrolTo(soldier, forward)) {
    soldier.pathIndex = forward
    return
  }
  soldier.patrolDir *= -1
  soldier.pathIndex = canSoldierPatrolTo(soldier, backward) ? backward : nearestPathInfo(soldier).index
}

function canSoldierPatrolTo(soldier, index) {
  const point = map.waypoints[index]
  return !!point && distance({ x: soldier.guardX, y: soldier.guardY }, point) <= soldier.guardRadius
}

function moveToward(actor, target, step, stopDistance) {
  const dist = distance(actor, target)
  if (dist <= stopDistance) return true
  const travel = Math.min(step, dist - stopDistance)
  actor.x += ((target.x - actor.x) / dist) * travel
  actor.y += ((target.y - actor.y) / dist) * travel
  return dist - travel <= stopDistance + 0.5
}

// 塔优先攻击路径进度最高的敌人，也就是最接近终点的威胁。
function findEnemyInRange(origin, range) {
  let best = null
  let progress = -1
  enemies.forEach((enemy) => {
    if (distance(origin, enemy) > range) return
    const p = enemy.waypoint * 10000 + enemy.x + enemy.y
    if (p > progress) {
      best = enemy
      progress = p
    }
  })
  return best
}

function nearestPathInfo(origin) {
  let index = 0
  let best = Infinity
  map.waypoints.forEach((point, i) => {
    const dist = distance(origin, point)
    if (dist < best) {
      best = dist
      index = i
    }
  })
  return { ...map.waypoints[index], index }
}

function finishGame() {
  state.running = false
  state.gameOver = true
  spawnQueue = []
  state.message = '城门失守，游戏结束'
}

// 所有动画特效共用 effects 队列，绘制时按 under/over 分层。
function createRingEffect(x, y, color, endRadius) {
  effects.push({ type: 'ring', x, y, age: 0, life: 360, radius: layout.cell * 0.08, endRadius, color })
}

function createDeathBurst(enemy) {
  const radiusScale = enemy.radiusScale || 1
  effects.push({
    type: 'enemyDeath',
    x: enemy.x,
    y: enemy.y,
    age: 0,
    life: 460,
    radius: layout.cell * (enemy.boss ? 0.82 : 0.48) * radiusScale,
    color: enemy.color || '#fca5a5',
    image: enemy.image,
    boss: enemy.boss
  })
  effects.push({ type: 'death', x: enemy.x, y: enemy.y, age: 0, life: 420, radius: layout.cell * 0.45 * radiusScale, color: enemy.color || '#fca5a5' })
  for (let i = 0; i < 8; i += 1) {
    const angle = (TWO_PI / 8) * i
    effects.push({ type: 'spark', x: enemy.x, y: enemy.y, vx: Math.cos(angle) * 0.05, vy: Math.sin(angle) * 0.05, age: 0, life: 420, radius: layout.cell * 0.08, color: enemy.color || '#fca5a5' })
  }
}

function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0)
  ctx.fillStyle = '#101723'
  ctx.fillRect(0, 0, W, H)
  drawHud()
  ctx.save()
  ctx.translate(layout.boardX, layout.boardY)
  drawGrid()
  drawPath()
  drawPathMarkers()
  drawSkillAuras('under')
  drawSelectedRange()
  drawPendingBuildCell()
  drawEffects('under')
  drawTowers()
  drawSoldiers()
  drawEnemies()
  drawProjectiles()
  drawEffects('over')
  drawSkillAuras('over')
  drawBossCurtain()
  ctx.restore()
  drawBuildMenu()
  drawControls()
  if (state.gameOver) drawGameOver()
}

function drawHud() {
  const items = [
    ['金币', state.gold],
    ['生命', state.lives],
    ['轮次', state.wave],
    ['状态', state.gameOver ? '结束' : bossCurtain ? '演出' : state.stasisTimer > 0 ? '冻结' : state.running ? '战斗中' : '待命']
  ]
  const gap = 8
  const w = (W - 20 - gap * 3) / 4
  items.forEach((item, i) => {
    const x = 10 + i * (w + gap)
    const y = layout.hudY
    roundRect(x, y, w, 48, 5, '#1b2638', '#334155')
    ctx.fillStyle = '#aeb8c8'
    ctx.font = '12px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(item[0], x + w / 2, y + 17)
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 18px sans-serif'
    ctx.fillText(item[1], x + w / 2, y + 39)
  })
}

// 网格颜色承担玩法语义：深绿是可建塔地块，棕色是道路阻挡区。
function drawGrid() {
  ctx.fillStyle = '#162132'
  ctx.fillRect(0, 0, layout.boardW, layout.boardH)
  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      ctx.fillStyle = map.blocked[`${col},${row}`] ? '#6b5b3d' : '#1f3a34'
      ctx.fillRect(col * layout.cell + 1, row * layout.cell + 1, layout.cell - 2, layout.cell - 2)
    }
  }
  ctx.strokeStyle = '#334155'
  ctx.strokeRect(0, 0, layout.boardW, layout.boardH)
}

function drawPath() {
  ctx.strokeStyle = '#d8b56d'
  ctx.lineWidth = Math.max(7, layout.cell * 0.34)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  map.waypoints.forEach((point, i) => {
    if (i === 0) ctx.moveTo(point.x, point.y)
    else ctx.lineTo(point.x, point.y)
  })
  ctx.stroke()
  ctx.strokeStyle = '#f4d891'
  ctx.lineWidth = Math.max(3, layout.cell * 0.13)
  ctx.beginPath()
  map.waypoints.forEach((point, i) => {
    if (i === 0) ctx.moveTo(point.x, point.y)
    else ctx.lineTo(point.x, point.y)
  })
  ctx.stroke()
}

function drawPathMarkers() {
  if (!map.waypoints || map.waypoints.length < 2) return
  drawPathMarker(map.waypoints[0], '入口', '#22c55e')
  drawPathMarker(map.waypoints[map.waypoints.length - 1], '出口', '#ef4444')
}

function drawPathMarker(point, label, color) {
  const w = Math.max(30, layout.cell * 1.9)
  const h = Math.max(18, layout.cell * 0.86)
  const x = Math.max(2, Math.min(layout.boardW - w - 2, point.x - w / 2))
  const y = Math.max(2, Math.min(layout.boardH - h - 2, point.y - h / 2))
  ctx.save()
  roundRect(x, y, w, h, 5, 'rgba(15, 23, 42, 0.82)', color)
  ctx.fillStyle = '#ffffff'
  ctx.font = `bold ${Math.max(10, Math.floor(layout.cell * 0.42))}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, x + w / 2, y + h / 2 + 0.5)
  ctx.restore()
}

function drawBossCurtain() {
  if (!bossCurtain) return
  const growRatio = Math.min(1, bossCurtain.age / bossCurtain.growTime)
  const fadeRatio = bossCurtain.age > bossCurtain.growTime + bossCurtain.marqueeTime
    ? Math.min(1, (bossCurtain.age - bossCurtain.growTime - bossCurtain.marqueeTime) / bossCurtain.fadeTime)
    : 0
  const ease = 1 - Math.pow(1 - growRatio, 3)
  const centerX = layout.boardW / 2
  const centerY = layout.boardH / 2
  const currentX = bossCurtain.x + (centerX - bossCurtain.x) * ease
  const currentY = bossCurtain.y + (centerY - bossCurtain.y) * ease
  const maxW = layout.boardW * 0.8
  const maxH = layout.boardH * 0.8
  const startSize = layout.cell * 1.8
  const target = Math.min(maxW, maxH)
  const size = startSize + (target - startSize) * ease
  const alpha = 1 - fadeRatio
  const image = getIconImage(bossCurtain.image)

  ctx.save()
  ctx.globalAlpha = alpha
  ctx.fillStyle = 'rgba(2, 6, 23, 0.52)'
  ctx.fillRect(0, 0, layout.boardW, layout.boardH)
  ctx.shadowColor = bossCurtain.color
  ctx.shadowBlur = layout.cell * 0.8
  if (image) {
    const aspect = image.width && image.height ? image.width / image.height : 1
    const w = aspect >= 1 ? size : size * aspect
    const h = aspect >= 1 ? size / aspect : size
    drawCenteredImage(image, currentX, currentY, w, h)
  } else {
    ctx.fillStyle = bossCurtain.color
    ctx.beginPath()
    ctx.arc(currentX, currentY, size / 2, 0, TWO_PI)
    ctx.fill()
  }
  ctx.shadowBlur = 0
  drawCurtainMarquee(bossCurtain, alpha)
  ctx.restore()
}

function drawCurtainMarquee(curtain, alpha) {
  const textY = layout.boardH * 0.5
  const boxH = Math.max(34, layout.cell * 1.45)
  const boxY = Math.max(8, Math.min(layout.boardH - boxH - 8, textY - boxH / 2))
  const fontSize = Math.max(18, Math.floor(layout.cell * 0.8))
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.fillStyle = 'rgba(15, 23, 42, 0.72)'
  roundRect(layout.cell, boxY, layout.boardW - layout.cell * 2, boxH, 8, 'rgba(15, 23, 42, 0.72)', curtain.color)
  ctx.beginPath()
  ctx.rect(layout.cell * 1.2, boxY, layout.boardW - layout.cell * 2.4, boxH)
  ctx.clip()
  ctx.font = `bold ${fontSize}px sans-serif`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  const textWidth = ctx.measureText(curtain.text).width
  const marqueeStart = curtain.growTime * 0.72
  const marqueeSpan = Math.max(1, curtain.marqueeTime + curtain.growTime * 0.28)
  const ratio = Math.max(0, Math.min(1, (curtain.age - marqueeStart) / marqueeSpan))
  const x = layout.boardW + layout.cell - ratio * (layout.boardW + textWidth + layout.cell * 2)
  ctx.lineWidth = Math.max(3, layout.cell * 0.12)
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.92)'
  ctx.strokeText(curtain.text, x, boxY + boxH / 2 + 1)
  ctx.fillStyle = '#fff7ed'
  ctx.fillText(curtain.text, x, boxY + boxH / 2 + 1)
  ctx.restore()
}

function drawSkillAuras(layer) {
  const freezeActive = state.freezeTimer > 0 || state.stasisTimer > 0
  const powerActive = state.powerTimer > 0
  if (layer === 'over' && freezeActive) drawFrostOverlay()
  if (layer === 'over' && powerActive) drawPowerUnitOverlay()
}

function drawFrostOverlay() {
  const time = Date.now() / 1000
  ctx.save()
  ctx.fillStyle = 'rgba(125, 211, 252, 0.16)'
  ctx.fillRect(0, 0, layout.boardW, layout.boardH)
  ctx.strokeStyle = 'rgba(224, 242, 254, 0.34)'
  ctx.lineWidth = Math.max(1, layout.cell * 0.04)
  for (let i = 0; i < 34; i += 1) {
    const x = (i * 47 + time * 18) % (layout.boardW + layout.cell) - layout.cell * 0.5
    const y = (i * 83 + Math.sin(time + i) * 26 + time * 22) % (layout.boardH + layout.cell) - layout.cell * 0.5
    const r = layout.cell * (0.08 + (i % 4) * 0.025)
    ctx.beginPath()
    for (let p = 0; p < 6; p += 1) {
      const a = (TWO_PI / 6) * p + time * 0.35
      ctx.moveTo(x, y)
      ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r)
    }
    ctx.stroke()
  }
  ctx.fillStyle = 'rgba(240, 249, 255, 0.14)'
  for (let i = 0; i < 42; i += 1) {
    const x = (i * 61 + time * 12) % layout.boardW
    const y = (i * 37 + time * 30) % layout.boardH
    ctx.beginPath()
    ctx.arc(x, y, layout.cell * (0.035 + (i % 3) * 0.014), 0, TWO_PI)
    ctx.fill()
  }
  ctx.restore()
}

function drawPowerUnitOverlay() {
  const time = Date.now() / 1000
  ctx.save()
  towers.forEach((tower) => drawPowerPulse(tower.x, tower.y, layout.cell * 0.9, time))
  soldiers.forEach((soldier) => drawPowerPulse(soldier.x, soldier.y, layout.cell * 0.45, time + 0.35))
  ctx.restore()
}

function drawPowerPulse(x, y, radius, time) {
  const pulse = 0.75 + Math.sin(time * 11) * 0.25
  ctx.save()
  ctx.shadowColor = '#fb923c'
  ctx.shadowBlur = layout.cell * 0.55
  for (let i = 0; i < 7; i += 1) {
    const offset = ((i - 3) / 3) * radius * 0.78
    const wave = Math.sin(time * 7 + i * 1.7)
    const baseY = y + radius * 0.58
    const flameH = radius * (0.92 + pulse * 0.32 + (i % 2) * 0.18)
    const flameW = radius * (0.22 + (i % 3) * 0.035)
    ctx.beginPath()
    ctx.moveTo(x + offset - flameW, baseY)
    ctx.quadraticCurveTo(
      x + offset - flameW * 0.9 + wave * radius * 0.14,
      baseY - flameH * 0.48,
      x + offset + wave * radius * 0.22,
      baseY - flameH
    )
    ctx.quadraticCurveTo(
      x + offset + flameW * 1.1 + wave * radius * 0.08,
      baseY - flameH * 0.42,
      x + offset + flameW,
      baseY
    )
    ctx.closePath()
    ctx.fillStyle = 'rgba(239, 68, 68, 0.72)'
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(x + offset - flameW * 0.48, baseY - radius * 0.04)
    ctx.quadraticCurveTo(
      x + offset + wave * radius * 0.12,
      baseY - flameH * 0.36,
      x + offset + wave * radius * 0.16,
      baseY - flameH * 0.72
    )
    ctx.quadraticCurveTo(
      x + offset + flameW * 0.48,
      baseY - flameH * 0.28,
      x + offset + flameW * 0.42,
      baseY - radius * 0.04
    )
    ctx.closePath()
    ctx.fillStyle = 'rgba(253, 186, 116, 0.86)'
    ctx.fill()
  }
  ctx.fillStyle = `rgba(251, 146, 60, ${0.18 + pulse * 0.16})`
  ctx.beginPath()
  ctx.ellipse(x, y + radius * 0.25, radius * 0.88, radius * 0.54, 0, 0, TWO_PI)
  ctx.fill()
  ctx.fillStyle = 'rgba(254, 240, 138, 0.86)'
  for (let i = 0; i < 5; i += 1) {
    const sparkX = x + Math.sin(time * 6 + i * 2.1) * radius * 0.9
    const sparkY = y - radius * (0.15 + ((time * 1.7 + i * 0.23) % 1) * 0.95)
    ctx.beginPath()
    ctx.arc(sparkX, sparkY, Math.max(1.1, layout.cell * 0.035), 0, TWO_PI)
    ctx.fill()
  }
  ctx.restore()
}

function drawSelectedRange() {
  const tower = towers.find((item) => item.id === state.selectedTowerId)
  if (!tower) return
  const radius = tower.type === 'barracks' ? barracksSoldierStats(tower).guardRadius : tower.range * layout.cell
  const center = tower.type === 'barracks' ? nearestPathInfo(tower) : tower
  ctx.fillStyle = 'rgba(110, 231, 183, 0.08)'
  ctx.strokeStyle = 'rgba(110, 231, 183, 0.42)'
  ctx.beginPath()
  ctx.arc(center.x, center.y, radius, 0, TWO_PI)
  ctx.fill()
  ctx.stroke()
}

function drawPendingBuildCell() {
  const cell = state.pendingBuildCell
  if (!cell) return

  const x = cell.col * layout.cell
  const y = cell.row * layout.cell
  const size = TOWER_SIZE * layout.cell
  ctx.fillStyle = 'rgba(110, 231, 183, 0.16)'
  ctx.fillRect(x, y, size, size)
  ctx.strokeStyle = '#6ee7b7'
  ctx.lineWidth = Math.max(2, layout.cell * 0.08)
  ctx.strokeRect(x + 1, y + 1, size - 2, size - 2)
}

function drawBuildMenu() {
  if (!state.pendingBuildCell) return
  updateBuildMenuButtons()

  layout.buildButtons.forEach((button) => {
    const tower = towerTypes[button.id]
    const canAfford = state.gold >= tower.cost
    const image = getIconImage(tower.image)
    roundRect(button.x, button.y, button.w, button.h, 6, canAfford ? '#1b2638' : '#334155', tower.color)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    if (image) {
      const size = Math.min(button.w * 0.5, button.h * 0.48)
      drawCenteredImage(image, button.x + button.w / 2, button.y + button.h * 0.34, size, size)
    } else {
      ctx.fillStyle = tower.color
      ctx.font = `bold ${Math.max(14, Math.floor(button.h * 0.42))}px sans-serif`
      ctx.fillText(tower.icon, button.x + button.w / 2, button.y + button.h * 0.34)
    }
    ctx.fillStyle = canAfford ? '#ffffff' : '#fecaca'
    ctx.font = `bold ${Math.max(10, Math.floor(button.h * 0.25))}px sans-serif`
    ctx.fillText(`${tower.cost}金`, button.x + button.w / 2, button.y + button.h * 0.72)
  })
}

// 塔的主体绘制按类型拆分，公共部分负责底座、等级和攻击后坐力缩放。
function drawTowers() {
  towers.forEach((tower) => {
    const type = towerTypes[tower.type]
    const image = getIconImage(type.image)
    const s = layout.cell * TOWER_SIZE
    const x = tower.col * layout.cell
    const y = tower.row * layout.cell
    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)'
    ctx.fillRect(x + layout.cell * 0.08, y + layout.cell * 0.08, s - layout.cell * 0.16, s - layout.cell * 0.16)
    ctx.strokeStyle = type.color
    ctx.lineWidth = Math.max(1.2, layout.cell * 0.05)
    ctx.strokeRect(x + layout.cell * 0.16, y + layout.cell * 0.16, s - layout.cell * 0.32, s - layout.cell * 0.32)

    const pulse = 1 + ((tower.recoilTimer || 0) / 140) * 0.12
    ctx.save()
    ctx.translate(tower.x, tower.y)
    ctx.scale(pulse, pulse)
    ctx.fillStyle = type.color
    if (image) {
      drawCenteredImage(image, 0, 0, s * 0.92, s * 0.92)
    } else if (tower.type === 'arrow') drawArrowTower(s)
    else if (tower.type === 'rocket') drawRocketTower(s)
    else if (tower.type === 'barracks') drawBarracksTower(s)
    else drawMagicTower(s)
    ctx.restore()

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    if (!image) {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.78)'
      ctx.beginPath()
      ctx.arc(tower.x, tower.y, layout.cell * 0.34, 0, TWO_PI)
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.font = `bold ${Math.max(8, Math.floor(layout.cell * 0.46))}px sans-serif`
      ctx.fillText(type.icon, tower.x, tower.y)
    }
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)'
    ctx.fillRect(tower.x - layout.cell * 0.52, tower.y + layout.cell * 0.58, layout.cell * 1.04, layout.cell * 0.34)
    ctx.fillStyle = '#ffffff'
    ctx.font = `bold ${Math.max(8, Math.floor(layout.cell * 0.3))}px sans-serif`
    ctx.fillText(`Lv${tower.level}`, tower.x, tower.y + layout.cell * 0.78)
  })
}

function drawArrowTower(s) {
  ctx.strokeStyle = '#e2e8f0'
  ctx.lineWidth = Math.max(1.2, s * 0.08)
  ctx.beginPath()
  ctx.arc(0, 0, s * 0.28, -1.2, 1.2)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(-s * 0.18, -s * 0.24)
  ctx.lineTo(s * 0.2, 0)
  ctx.lineTo(-s * 0.18, s * 0.24)
  ctx.stroke()
  ctx.fillStyle = '#facc15'
  ctx.beginPath()
  ctx.arc(0, 0, s * 0.12, 0, TWO_PI)
  ctx.fill()
}

function drawRocketTower(s) {
  ctx.fillStyle = '#7c2d12'
  ctx.fillRect(-s * 0.25, -s * 0.22, s * 0.5, s * 0.44)
  ctx.fillStyle = '#f97316'
  ctx.beginPath()
  ctx.arc(0, -s * 0.05, s * 0.25, 0, TWO_PI)
  ctx.fill()
  ctx.fillStyle = '#fed7aa'
  ctx.fillRect(s * 0.06, -s * 0.1, s * 0.32, s * 0.13)
}

function drawBarracksTower(s) {
  ctx.fillStyle = '#14532d'
  ctx.fillRect(-s * 0.28, -s * 0.12, s * 0.56, s * 0.36)
  ctx.fillStyle = '#22c55e'
  ctx.beginPath()
  ctx.moveTo(-s * 0.34, -s * 0.1)
  ctx.lineTo(0, -s * 0.38)
  ctx.lineTo(s * 0.34, -s * 0.1)
  ctx.closePath()
  ctx.fill()
}

function drawMagicTower(s) {
  ctx.fillStyle = '#4c1d95'
  ctx.beginPath()
  ctx.moveTo(0, -s * 0.36)
  ctx.lineTo(s * 0.28, s * 0.25)
  ctx.lineTo(-s * 0.28, s * 0.25)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#c4b5fd'
  ctx.beginPath()
  ctx.arc(0, -s * 0.15, s * 0.14, 0, TWO_PI)
  ctx.fill()
}

function drawSoldiers() {
  soldiers.forEach((soldier) => {
    const image = getIconImage(soldierIconPath)
    const spawnRatio = Math.min(1, 1 - (soldier.spawnTimer || 0) / 360)
    const pop = soldier.spawnTimer > 0 ? 0.55 + spawnRatio * 0.55 : 1
    const bob = Math.sin(Date.now() / 140 + soldier.pathIndex) * layout.cell * 0.025
    const blockedEnemy = enemies.find((enemy) => enemy.id === soldier.blockingEnemyId)
    if (blockedEnemy) {
      ctx.strokeStyle = 'rgba(187, 247, 208, 0.7)'
      ctx.beginPath()
      ctx.moveTo(soldier.x, soldier.y)
      ctx.lineTo(blockedEnemy.x, blockedEnemy.y)
      ctx.stroke()
    }
    ctx.save()
    ctx.globalAlpha = 0.24
    ctx.fillStyle = '#020617'
    ctx.beginPath()
    ctx.ellipse(soldier.x, soldier.y + layout.cell * 0.31, layout.cell * 0.38 * pop, layout.cell * 0.12, 0, 0, TWO_PI)
    ctx.fill()
    ctx.restore()
    if (image) {
      const size = layout.cell * 1.12 * pop
      ctx.save()
      ctx.translate(soldier.x, soldier.y + bob)
      ctx.scale(pop, pop)
      if (soldier.swingTimer > 0) ctx.rotate(Math.sin(soldier.swingTimer / 28) * 0.18)
      drawCenteredImage(image, 0, 0, size / pop, size / pop)
      ctx.restore()
    } else {
      ctx.fillStyle = '#86efac'
      ctx.beginPath()
      ctx.arc(soldier.x, soldier.y, layout.cell * 0.22 * pop, 0, TWO_PI)
      ctx.fill()
    }
    if (soldier.spawnTimer > 0) {
      ctx.save()
      ctx.globalAlpha = 1 - spawnRatio
      ctx.strokeStyle = '#bbf7d0'
      ctx.lineWidth = Math.max(1, layout.cell * 0.06)
      ctx.beginPath()
      ctx.arc(soldier.x, soldier.y, layout.cell * (0.28 + spawnRatio * 0.46), 0, TWO_PI)
      ctx.stroke()
      ctx.restore()
    }
    const hpRatio = Math.max(0, soldier.hp / soldier.maxHp)
    const width = layout.cell * 0.68
    ctx.fillStyle = '#111827'
    ctx.fillRect(soldier.x - width / 2, soldier.y - layout.cell * 0.58, width, 3)
    ctx.fillStyle = '#86efac'
    ctx.fillRect(soldier.x - width / 2, soldier.y - layout.cell * 0.58, width * hpRatio, 3)
  })
}

// 敌人优先绘制 PNG 图标；幽影兵额外画斜线，表示无视兵营阻挡。
function drawEnemies() {
  enemies.forEach((enemy) => {
    const stride = Math.sin((enemy.movePulse || 0) + enemy.wobble)
    const bob = stride * layout.cell * 0.045
    const crying = enemy.specialActionTimer > 0 && enemy.bossKind === 'anna'
    const squash = enemy.blockedBy || crying || enemy.freezeTimer > 0 || state.freezeTimer > 0
      ? 1
      : 1 + Math.abs(stride) * 0.07
    const lean = enemy.blockedBy ? 0 : Math.sin((enemy.movePulse || 0) * 0.5 + enemy.wobble) * 0.12
    const flash = enemy.hurtTimer > 0 && Math.floor(enemy.hurtTimer / 35) % 2 === 0
    const frozen = enemy.freezeTimer > 0 || state.freezeTimer > 0
    const radius = (enemy.boss ? layout.cell * 0.36 : layout.cell * 0.34) * (enemy.radiusScale || 1)
    const bodyColor = enemy.color || '#f43f5e'
    const image = getIconImage(enemy.image)
    ctx.save()
    ctx.globalAlpha = 0.26
    ctx.fillStyle = '#020617'
    ctx.beginPath()
    ctx.ellipse(enemy.x, enemy.y + radius * 1.14, radius * 1.3, radius * 0.36, 0, 0, TWO_PI)
    ctx.fill()
    ctx.restore()
    if (image) {
      const size = radius * (enemy.boss ? 3.75 : 3.55)
      ctx.save()
      ctx.translate(enemy.x, enemy.y + bob)
      ctx.rotate(lean)
      ctx.scale(1 / squash, squash)
      drawCenteredImage(image, 0, 0, size, size)
      ctx.restore()
      if (flash || frozen || enemy.slowTimer > 0 || crying) {
        ctx.save()
        ctx.globalAlpha = flash ? 0.36 : crying ? 0.22 : 0.28
        ctx.fillStyle = flash ? '#ffffff' : crying ? '#f9a8d4' : '#7dd3fc'
        ctx.beginPath()
        ctx.arc(enemy.x, enemy.y + bob, radius * 1.28, 0, TWO_PI)
        ctx.fill()
        ctx.restore()
      }
    } else {
      ctx.save()
      ctx.translate(enemy.x, enemy.y + bob)
      ctx.rotate(lean)
      ctx.scale(1 / squash, squash)
      ctx.fillStyle = flash ? '#ffffff' : crying ? '#f9a8d4' : frozen ? '#7dd3fc' : enemy.slowTimer > 0 ? '#67e8f9' : bodyColor
      ctx.beginPath()
      ctx.arc(0, 0, radius, 0, TWO_PI)
      ctx.fill()
      ctx.strokeStyle = '#0f172a'
      ctx.lineWidth = Math.max(1.2, layout.cell * 0.05)
      ctx.stroke()
      if (enemy.mark) {
        ctx.fillStyle = enemy.boss ? '#fef3c7' : '#111827'
        ctx.font = `bold ${Math.max(7, Math.floor(radius * 0.9))}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(enemy.mark, 0, 0.5)
      }
      ctx.restore()
    }
    if (enemy.boss) {
      ctx.strokeStyle = '#fbbf24'
      ctx.lineWidth = Math.max(2, layout.cell * 0.08)
      ctx.beginPath()
      ctx.arc(enemy.x, enemy.y + bob, radius + layout.cell * 0.08, 0, TWO_PI)
      ctx.stroke()
    }
    if (crying) {
      drawCryingBadge(enemy.x, enemy.y + bob, radius)
    }
    if (enemy.blockImmune) {
      ctx.strokeStyle = '#f5d0fe'
      ctx.lineWidth = Math.max(1.2, layout.cell * 0.05)
      ctx.beginPath()
      ctx.moveTo(enemy.x - radius * 0.65, enemy.y + bob + radius * 0.65)
      ctx.lineTo(enemy.x + radius * 0.65, enemy.y + bob - radius * 0.65)
      ctx.stroke()
    }
    if (enemy.blockedBy) {
      ctx.strokeStyle = '#bbf7d0'
      ctx.beginPath()
      ctx.arc(enemy.x, enemy.y + bob, radius + layout.cell * 0.08, 0, TWO_PI)
      ctx.stroke()
    }
    const width = enemy.boss ? layout.cell * 1.18 : layout.cell * 0.78
    const hp = Math.max(0, enemy.hp / enemy.maxHp)
    ctx.fillStyle = '#111827'
    ctx.fillRect(enemy.x - width / 2, enemy.y - layout.cell * 0.58, width, 4)
    ctx.fillStyle = '#22c55e'
    ctx.fillRect(enemy.x - width / 2, enemy.y - layout.cell * 0.58, width * hp, 4)
  })
}

function drawCryingBadge(x, y, radius) {
  const time = Date.now() / 1000
  ctx.save()
  ctx.strokeStyle = '#60a5fa'
  ctx.fillStyle = '#93c5fd'
  ctx.lineWidth = Math.max(1.2, layout.cell * 0.055)
  for (let i = 0; i < 4; i += 1) {
    const dx = (i < 2 ? -1 : 1) * radius * (0.32 + (i % 2) * 0.18)
    const drop = ((time * 1.9 + i * 0.27) % 1) * radius * 0.95
    const tx = x + dx
    const ty = y - radius * 0.26 + drop
    ctx.beginPath()
    ctx.ellipse(tx, ty, radius * 0.1, radius * 0.18, 0, 0, TWO_PI)
    ctx.fill()
  }
  ctx.fillStyle = '#fef3c7'
  ctx.font = `bold ${Math.max(9, Math.floor(layout.cell * 0.42))}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('哭', x, y - radius * 1.35)
  ctx.restore()
}

function drawProjectiles() {
  projectiles.forEach((p) => {
    if (p.type === 'rocket') {
      ctx.save()
      const tailX = p.x - Math.cos(p.angle) * layout.cell * 0.22
      const tailY = p.y - Math.sin(p.angle) * layout.cell * 0.22
      ctx.strokeStyle = 'rgba(253, 186, 116, 0.85)'
      ctx.lineWidth = Math.max(2, layout.cell * 0.16)
      ctx.beginPath()
      ctx.moveTo(p.prevX, p.prevY)
      ctx.lineTo(tailX, tailY)
      ctx.stroke()
      ctx.restore()
    }
    ctx.strokeStyle = p.color
    ctx.lineWidth = p.type === 'rocket' ? Math.max(1.8, layout.cell * 0.12) : Math.max(1.2, layout.cell * 0.08)
    ctx.beginPath()
    ctx.moveTo(p.prevX, p.prevY)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    ctx.fillStyle = p.color
    ctx.beginPath()
    ctx.arc(p.x, p.y, layout.cell * 0.12, 0, TWO_PI)
    ctx.fill()
    if (p.type === 'rocket') {
      ctx.fillStyle = '#fff7ed'
      ctx.beginPath()
      ctx.arc(p.x, p.y, layout.cell * 0.055, 0, TWO_PI)
      ctx.fill()
    }
  })
}

function drawEffects(layer) {
  effects.forEach((e) => {
    const over = e.type !== 'ring'
    if ((layer === 'over') !== over) return
    const ratio = Math.min(1, e.age / e.life)
    const alpha = 1 - ratio
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.strokeStyle = e.color
    ctx.fillStyle = e.color
    if (e.type === 'ring') {
      const radius = e.radius + (e.endRadius - e.radius) * ratio
      ctx.beginPath()
      ctx.arc(e.x, e.y, radius, 0, TWO_PI)
      ctx.stroke()
    } else if (e.type === 'beam') {
      ctx.lineWidth = Math.max(2, layout.cell * (0.13 - ratio * 0.06))
      ctx.beginPath()
      ctx.moveTo(e.fromX || e.x, e.fromY || e.y)
      ctx.lineTo(e.toX, e.toY)
      ctx.stroke()
    } else if (e.type === 'muzzle') {
      const radius = e.radius * (1 + ratio * 1.35)
      ctx.save()
      ctx.translate(e.x, e.y)
      ctx.rotate(e.angle)
      ctx.fillStyle = '#fff7ed'
      ctx.beginPath()
      ctx.moveTo(radius * 1.4, 0)
      ctx.lineTo(-radius * 0.45, -radius * 0.65)
      ctx.lineTo(-radius * 0.1, 0)
      ctx.lineTo(-radius * 0.45, radius * 0.65)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = e.color
      ctx.lineWidth = Math.max(1, layout.cell * 0.04)
      ctx.stroke()
      ctx.restore()
    } else if (e.type === 'screen') {
      ctx.fillStyle = e.color
      ctx.globalAlpha = alpha * 0.16
      ctx.fillRect(0, 0, layout.boardW, layout.boardH)
    } else if (e.type === 'enemyDeath' || e.type === 'soldierDeath') {
      const image = getIconImage(e.image)
      const scale = e.type === 'soldierDeath' ? 1 + ratio * 0.35 : 1 + ratio * 0.55
      ctx.globalAlpha = alpha * alpha
      ctx.translate(e.x, e.y - layout.cell * 0.18 * ratio)
      ctx.rotate(ratio * (e.type === 'soldierDeath' ? -0.35 : 0.45))
      if (image) {
        drawCenteredImage(image, 0, 0, e.radius * 3.2 * scale, e.radius * 3.2 * scale)
      } else {
        ctx.beginPath()
        ctx.arc(0, 0, e.radius * scale, 0, TWO_PI)
        ctx.fill()
      }
    } else if (e.type === 'shockwave') {
      const radius = e.radius + (e.endRadius - e.radius) * ratio
      ctx.globalAlpha = alpha * 0.85
      ctx.lineWidth = Math.max(2, layout.cell * (0.18 - ratio * 0.12))
      ctx.beginPath()
      ctx.arc(e.x, e.y, radius, 0, TWO_PI)
      ctx.stroke()
    } else if (e.type === 'cry') {
      const radius = e.radius * (0.82 + Math.sin(e.age / 140) * 0.08)
      ctx.globalAlpha = 0.42 + Math.sin(e.age / 120) * 0.14
      ctx.lineWidth = Math.max(2, layout.cell * 0.08)
      ctx.beginPath()
      ctx.arc(e.x, e.y, radius, 0, TWO_PI)
      ctx.stroke()
      ctx.fillStyle = '#93c5fd'
      for (let i = 0; i < 8; i += 1) {
        const angle = (TWO_PI / 8) * i + e.age / 420
        const tx = e.x + Math.cos(angle) * radius * 0.72
        const ty = e.y + Math.sin(angle) * radius * 0.42 + (ratio * layout.cell * 0.28)
        ctx.beginPath()
        ctx.ellipse(tx, ty, layout.cell * 0.06, layout.cell * 0.12, 0, 0, TWO_PI)
        ctx.fill()
      }
    } else if (e.type === 'heal') {
      const radius = e.radius + (e.endRadius - e.radius) * ratio
      ctx.globalAlpha = alpha * 0.78
      ctx.lineWidth = Math.max(2, layout.cell * 0.08)
      ctx.beginPath()
      ctx.arc(e.x, e.y, radius, 0, TWO_PI)
      ctx.stroke()
      ctx.fillStyle = '#bbf7d0'
      ctx.font = `bold ${Math.max(10, Math.floor(layout.cell * 0.5))}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('+HP', e.x, e.y - radius * 0.28)
    } else if (e.type === 'explosion') {
      const radius = e.radius * (0.28 + ratio * 0.9)
      ctx.globalAlpha = alpha * 0.72
      ctx.beginPath()
      ctx.arc(e.x, e.y, radius, 0, TWO_PI)
      ctx.fill()
      ctx.fillStyle = '#fff7ed'
      ctx.globalAlpha = alpha * 0.5
      ctx.beginPath()
      ctx.arc(e.x, e.y, radius * 0.42, 0, TWO_PI)
      ctx.fill()
    } else if (e.type === 'death') {
      ctx.beginPath()
      ctx.arc(e.x, e.y, e.radius * (0.25 + ratio), 0, TWO_PI)
      ctx.fill()
    } else if (e.type === 'spark') {
      if (e.vx || e.vy) {
        ctx.globalAlpha = alpha
      }
      ctx.beginPath()
      ctx.arc(e.x, e.y, e.radius, 0, TWO_PI)
      ctx.fill()
    } else if (e.type === 'hit' || e.type === 'slash') {
      ctx.beginPath()
      ctx.arc(e.x, e.y, e.radius || layout.cell * 0.3, 0, TWO_PI)
      ctx.stroke()
    }
    ctx.restore()
  })
}

// 底部控制区每帧重算按钮文字：本轮出完但未清场时显示“提前开始第 N 轮”。
function drawControls() {
  buildButtons()
  const canStartWave = canStartNextWave()
  const earlyWaveReady = state.running && spawnQueue.length === 0 && enemies.length > 0
  layout.actionButtons[0].text = earlyWaveReady ? `提前开始第 ${state.wave + 1} 轮` : `开始第 ${state.wave + 1} 轮`
  layout.actionButtons[2].text = `${state.gameSpeed}x速度`
  layout.actionButtons.forEach((button) => {
    const disabled = button.id === 'speed'
      ? state.gameOver
      : button.id === 'map'
        ? state.running || state.gameOver
        : !canStartWave
    const fill = button.id === 'speed'
      ? state.gameSpeed === 2 ? '#7c3aed' : '#475569'
      : button.id === 'wave' ? '#2563eb' : '#475569'
    roundRect(button.x, button.y, button.w, button.h, 5, disabled ? '#475569' : fill, '#64748b')
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 15px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(button.text, button.x + button.w / 2, button.y + 28)
  })

  drawSkillButtons()

  const selected = towers.find((tower) => tower.id === state.selectedTowerId)
  const panelY = layout.skillButtons[0].y + 52
  roundRect(10, panelY, W - 20, 58, 5, '#1b2638', '#334155')
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 14px sans-serif'
  ctx.textAlign = 'left'
  if (selected) {
    const refund = Math.max(1, Math.round((selected.investedGold || towerTypes[selected.type].cost) * 0.6))
    ctx.fillText(`${selected.name} Lv.${selected.level}`, 22, panelY + 22)
    ctx.fillStyle = '#b8c4d8'
    ctx.font = '12px sans-serif'
    ctx.fillText(`伤害 ${selected.damage}  射程 ${selected.range}  升级 ${selected.upgradeCost}金`, 22, panelY + 44)
    const buttonW = 70
    const ux = W - 166
    const sx = W - 88
    roundRect(ux, panelY + 12, buttonW, 34, 5, state.gold >= selected.upgradeCost ? '#059669' : '#475569', '#10b981')
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 14px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('升级', ux + buttonW / 2, panelY + 34)
    roundRect(sx, panelY + 12, buttonW, 34, 5, '#b45309', '#f59e0b')
    ctx.fillStyle = '#ffffff'
    ctx.fillText('出售', sx + buttonW / 2, panelY + 34)
    ctx.fillStyle = '#fbbf24'
    ctx.font = '10px sans-serif'
    ctx.fillText(`${refund}金`, sx + buttonW / 2, panelY + 48)
    layout.upgradeButton = { x: ux, y: panelY + 12, w: buttonW, h: 34 }
    layout.sellButton = { x: sx, y: panelY + 12, w: buttonW, h: 34 }
  } else {
    ctx.fillText(state.message, 22, panelY + 24)
    ctx.fillStyle = '#b8c4d8'
    ctx.font = '12px sans-serif'
    ctx.fillText('点击空地后在地图上选择塔，点击已有塔升级。', 22, panelY + 45)
    layout.upgradeButton = null
    layout.sellButton = null
  }
}

function drawSkillButtons() {
  layout.skillButtons.forEach((button) => {
    const isFreeze = button.id === 'freeze'
    const cooldown = isFreeze ? state.freezeCooldown : state.powerCooldown
    const active = isFreeze ? state.freezeTimer > 0 || state.stasisTimer > 0 : state.powerTimer > 0
    const disabled = state.gameOver || cooldown > 0
    const label = isFreeze ? '冻结全场' : '攻击+50%'
    const text = active ? '生效中' : cooldown > 0 ? `${Math.ceil(cooldown / 1000)}s` : label
    const fill = disabled ? '#475569' : isFreeze ? '#0369a1' : '#b45309'
    const stroke = active ? '#fef3c7' : isFreeze ? '#38bdf8' : '#f59e0b'

    roundRect(button.x, button.y, button.w, button.h, 5, fill, stroke)
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 15px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(text, button.x + button.w / 2, button.y + 26)
  })
}

function drawGameOver() {
  ctx.fillStyle = 'rgba(5, 10, 18, 0.78)'
  ctx.fillRect(0, 0, W, H)
  const cw = W - 50
  const ch = 360
  const x = 25
  const y = (H - ch) / 2
  roundRect(x, y, cw, ch, 6, '#182231', '#f87171')
  ctx.fillStyle = '#fecaca'
  ctx.font = 'bold 34px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('GAME OVER', W / 2, y + 50)
  ctx.fillStyle = '#cbd5e1'
  ctx.font = '14px sans-serif'
  ctx.fillText('城门失守，防线结算', W / 2, y + 76)

  const rows = [
    ['坚持轮次', state.wave],
    ['完成轮次', Math.max(0, state.wave - 1)],
    ['消灭敌人', state.kills],
    ['漏过敌人', state.escaped],
    ['赚取金币', state.earnedGold],
    ['花费金币', state.spentGold],
    ['建造塔数', state.towersBuilt],
    ['剩余金币', state.gold]
  ]
  rows.forEach((row, i) => {
    const col = i % 2
    const r = Math.floor(i / 2)
    const bx = x + 16 + col * ((cw - 42) / 2 + 10)
    const by = y + 98 + r * 48
    const bw = (cw - 42) / 2
    roundRect(bx, by, bw, 38, 5, 'rgba(255,255,255,0.06)', '#334155')
    ctx.fillStyle = '#aeb8c8'
    ctx.font = '11px sans-serif'
    ctx.fillText(row[0], bx + bw / 2, by + 15)
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 18px sans-serif'
    ctx.fillText(row[1], bx + bw / 2, by + 33)
  })
  layout.restartButton = { x: x + 32, y: y + ch - 62, w: cw - 64, h: 44 }
  roundRect(layout.restartButton.x, layout.restartButton.y, layout.restartButton.w, layout.restartButton.h, 5, '#dc2626', '#ef4444')
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 17px sans-serif'
  ctx.fillText('重新开始', W / 2, layout.restartButton.y + 29)
}

// 触摸事件统一从 UI 控件到地图格子逐层命中，避免点按钮时也触发建塔。
function handleTouch(x, y) {
  if (state.gameOver) {
    if (layout.restartButton && hitRect(x, y, layout.restartButton)) resetGame()
    return
  }
  if (bossCurtain) return
  const buildButton = layout.buildButtons.find((button) => hitRect(x, y, button))
  if (buildButton && state.pendingBuildCell) {
    tryBuildTower(state.pendingBuildCell.col, state.pendingBuildCell.row, buildButton.id)
    return
  }
  const actionButton = layout.actionButtons.find((button) => hitRect(x, y, button))
  if (actionButton) {
    if (actionButton.id === 'wave') startWave()
    if (actionButton.id === 'map') rerollMap()
    if (actionButton.id === 'speed') toggleGameSpeed()
    return
  }
  const skillButton = layout.skillButtons.find((button) => hitRect(x, y, button))
  if (skillButton) {
    if (skillButton.id === 'freeze') castFreezeSkill()
    if (skillButton.id === 'power') castPowerSkill()
    return
  }
  if (layout.upgradeButton && hitRect(x, y, layout.upgradeButton)) {
    upgradeSelectedTower()
    return
  }
  if (layout.sellButton && hitRect(x, y, layout.sellButton)) {
    sellSelectedTower()
    return
  }
  const gx = x - layout.boardX
  const gy = y - layout.boardY
  if (gx < 0 || gy < 0 || gx >= layout.boardW || gy >= layout.boardH) return
  const col = Math.floor(gx / layout.cell)
  const row = Math.floor(gy / layout.cell)
  const tower = findTowerAt(col, row)
  if (tower) {
    state.selectedTowerId = tower.id
    state.pendingBuildCell = null
    state.message = `${tower.name} Lv.${tower.level}`
    return
  }
  const check = canPlaceTower(col, row)
  if (!check.ok) {
    state.pendingBuildCell = null
    state.selectedTowerId = null
    state.message = check.message
    return
  }
  state.pendingBuildCell = { col, row }
  state.selectedTowerId = null
  state.message = '选择要建造的塔'
}

function roundRect(x, y, w, h, r, fill, stroke) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
  if (stroke) {
    ctx.strokeStyle = stroke
    ctx.stroke()
  }
}

function hitRect(x, y, rect) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h
}

function distance(a, b) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function loop() {
  const now = Date.now()
  const dt = Math.min(80, now - lastTime)
  lastTime = now
  update(dt * state.gameSpeed)
  draw()
  requestAnimationFrame(loop)
}

wx.onTouchStart((event) => {
  const touch = event.touches[0]
  if (!touch) return
  handleTouch(touch.clientX, touch.clientY)
})

wx.onShow(() => {
  lastTime = Date.now()
})

preloadIconImages()
resetGame()
loop()
