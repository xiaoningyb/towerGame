const GRID_COLS = 18
const GRID_ROWS = 24
const TOWER_SIZE = 2
const FRAME_MS = 1000 / 30
const TWO_PI = Math.PI * 2
const SOLDIER_DAMAGE_RATIO = 0.48

const TOWER_TYPES = {
  arrow: {
    id: 'arrow',
    name: '箭塔',
    icon: '弓',
    cost: 45,
    color: '#f8fafc',
    range: 5.6,
    damage: 16,
    cooldown: 480,
    description: '高射速单体攻击'
  },
  rocket: {
    id: 'rocket',
    name: '火箭塔',
    icon: '炮',
    cost: 80,
    color: '#f97316',
    range: 4.8,
    damage: 28,
    cooldown: 1050,
    splash: 1.8,
    description: '慢速范围爆炸'
  },
  barracks: {
    id: 'barracks',
    name: '兵营',
    icon: '营',
    cost: 65,
    color: '#22c55e',
    range: 3.4,
    damage: 8,
    cooldown: 820,
    description: '派出士兵拦截'
  },
  magic: {
    id: 'magic',
    name: '魔法塔',
    icon: '法',
    cost: 70,
    color: '#a78bfa',
    range: 5.2,
    damage: 12,
    cooldown: 760,
    slow: 0.48,
    description: '攻击并短暂减速'
  }
}

Page({
  data: {
    gold: 160,
    lives: 20,
    wave: 0,
    running: false,
    gameOver: false,
    showGameOver: false,
    kills: 0,
    escaped: 0,
    earnedGold: 0,
    spentGold: 0,
    towersBuilt: 0,
    gameOverStats: null,
    message: '选择塔并点击地图建造',
    selectedTower: null,
    selectedTowerType: 'arrow',
    towerList: Object.keys(TOWER_TYPES).map((key) => TOWER_TYPES[key])
  },

  onReady() {
    this.ctx = wx.createCanvasContext('battlefield', this)
    this.lastTick = Date.now()
    this.resetGame()
    this.measureCanvas()
  },

  onUnload() {
    this.stopLoop()
  },

  measureCanvas() {
    wx.createSelectorQuery()
      .in(this)
      .select('.battlefield')
      .boundingClientRect((rect) => {
        if (!rect) return
        this.canvasWidth = rect.width
        this.canvasHeight = rect.height
        this.cell = Math.min(rect.width / GRID_COLS, rect.height / GRID_ROWS)
        this.offsetX = (rect.width - this.cell * GRID_COLS) / 2
        this.offsetY = (rect.height - this.cell * GRID_ROWS) / 2
        this.refreshMapMetrics()
        this.draw()
        this.startLoop()
      })
      .exec()
  },

  resetGame() {
    this.map = this.createMap()
    this.towers = []
    this.enemies = []
    this.projectiles = []
    this.soldiers = []
    this.effects = []
    this.spawnQueue = []
    this.spawnTimer = 0
    this.setData({
      gold: 160,
      lives: 20,
      wave: 0,
      running: false,
      gameOver: false,
      showGameOver: false,
      kills: 0,
      escaped: 0,
      earnedGold: 0,
      spentGold: 0,
      towersBuilt: 0,
      gameOverStats: null,
      selectedTower: null,
      message: '随机地图已生成，准备防守'
    })
  },

  startLoop() {
    if (this.loopTimer) return
    this.loopTimer = setInterval(() => {
      const now = Date.now()
      const dt = Math.min(80, now - this.lastTick)
      this.lastTick = now
      this.update(dt)
      this.draw()
    }, FRAME_MS)
  },

  stopLoop() {
    if (this.loopTimer) {
      clearInterval(this.loopTimer)
      this.loopTimer = null
    }
  },

  createMap() {
    const blocked = {}
    const pathCells = []
    let col = 0
    let row = this.randInt(3, GRID_ROWS - 4)

    const addCell = (nextCol, nextRow) => {
      const safeCol = Math.max(0, Math.min(GRID_COLS - 1, nextCol))
      const safeRow = Math.max(1, Math.min(GRID_ROWS - 2, nextRow))
      const last = pathCells[pathCells.length - 1]
      if (last && last.col === safeCol && last.row === safeRow) return
      pathCells.push({ col: safeCol, row: safeRow })
      blocked[`${safeCol},${safeRow}`] = true
      col = safeCol
      row = safeRow
    }

    addCell(col, row)

    while (col < GRID_COLS - 1) {
      const segment = Math.min(this.randInt(1, 3), GRID_COLS - 1 - col)
      for (let i = 0; i < segment; i += 1) {
        addCell(col + 1, row)
      }

      if (col >= GRID_COLS - 1) break

      const verticalSteps = this.randInt(2, 6)
      let dir = Math.random() > 0.5 ? 1 : -1
      if (row <= 4) dir = 1
      if (row >= GRID_ROWS - 5) dir = -1

      for (let i = 0; i < verticalSteps; i += 1) {
        const nextRow = row + dir
        if (nextRow < 1 || nextRow > GRID_ROWS - 2) break
        addCell(col, nextRow)
      }
    }

    return {
      blocked,
      pathCells,
      waypoints: pathCells.map((cell) => this.cellCenter(cell.col, cell.row))
    }
  },

  refreshMapMetrics() {
    if (!this.map || !this.cell) return
    this.map.waypoints = this.map.pathCells.map((cell) => this.cellCenter(cell.col, cell.row))
    this.towers.forEach((tower) => {
      const center = this.towerCenter(tower.col, tower.row)
      tower.x = center.x
      tower.y = center.y
    })
  },

  rerollMap() {
    if (this.data.running) return
    this.map = this.createMap()
    this.towers = []
    this.enemies = []
    this.projectiles = []
    this.soldiers = []
    this.effects = []
    this.spawnQueue = []
    this.setData({
      selectedTower: null,
      message: '新地图已生成，金币和生命保留'
    })
    this.draw()
  },

  chooseTower(event) {
    this.setData({
      selectedTowerType: event.currentTarget.dataset.type,
      selectedTower: null
    })
  },

  onCanvasTap(event) {
    if (this.data.gameOver || !this.cell) return
    const touch = event.touches[0]
    const x = touch.x - this.offsetX
    const y = touch.y - this.offsetY
    const col = Math.floor(x / this.cell)
    const row = Math.floor(y / this.cell)
    if (!this.inGrid(col, row)) return

    const tower = this.findTowerAt(col, row)
    if (tower) {
      this.selectTower(tower)
      return
    }

    this.tryBuildTower(col, row)
  },

  tryBuildTower(col, row) {
    const type = TOWER_TYPES[this.data.selectedTowerType]
    const check = this.canPlaceTower(col, row)
    if (!check.ok) {
      this.setData({ message: check.message })
      return
    }
    if (this.data.gold < type.cost) {
      this.setData({ message: `金币不足，需要 ${type.cost}` })
      return
    }

    const tower = {
      id: `${Date.now()}-${Math.random()}`,
      type: type.id,
      name: type.name,
      col,
      row,
      size: TOWER_SIZE,
      x: this.towerCenter(col, row).x,
      y: this.towerCenter(col, row).y,
      level: 1,
      range: type.range,
      damage: type.damage,
      cooldown: type.cooldown,
      fireTimer: 0,
      upgradeCost: Math.round(type.cost * 0.72)
    }
    this.towers.push(tower)
    this.createRingEffect(tower.x, tower.y, type.color, this.cell * 0.9)
    this.setData({
      gold: this.data.gold - type.cost,
      spentGold: this.data.spentGold + type.cost,
      towersBuilt: this.data.towersBuilt + 1,
      selectedTower: this.publicTower(tower),
      message: `${type.name} 已建造`
    })
  },

  selectTower(tower) {
    this.setData({
      selectedTower: this.publicTower(tower),
      message: `${tower.name} Lv.${tower.level}`
    })
  },

  canPlaceTower(col, row) {
    if (col < 0 || row < 0 || col + TOWER_SIZE > GRID_COLS || row + TOWER_SIZE > GRID_ROWS) {
      return { ok: false, message: '塔需要 2x2 空地，不能超出地图' }
    }

    for (let y = row; y < row + TOWER_SIZE; y += 1) {
      for (let x = col; x < col + TOWER_SIZE; x += 1) {
        if (this.map.blocked[`${x},${y}`]) {
          return { ok: false, message: '2x2 范围内有道路，不能建塔' }
        }
        if (this.findTowerAt(x, y)) {
          return { ok: false, message: '2x2 范围内已有塔' }
        }
      }
    }

    return { ok: true }
  },

  findTowerAt(col, row) {
    return this.towers.find((tower) => {
      const size = tower.size || TOWER_SIZE
      return col >= tower.col &&
        col < tower.col + size &&
        row >= tower.row &&
        row < tower.row + size
    })
  },

  upgradeSelected() {
    const selected = this.data.selectedTower
    if (!selected) return
    const tower = this.towers.find((item) => item.id === selected.id)
    if (!tower || this.data.gold < tower.upgradeCost) return

    const cost = tower.upgradeCost
    tower.level += 1
    tower.damage = Math.round(tower.damage * 1.38)
    tower.range = +(tower.range + 0.18).toFixed(2)
    tower.cooldown = Math.max(260, Math.round(tower.cooldown * 0.9))
    tower.upgradeCost = Math.round(tower.upgradeCost * 1.55)
    tower.recoilTimer = 180

    this.refreshBarracksSoldiers(tower)
    this.createRingEffect(tower.x, tower.y, TOWER_TYPES[tower.type].color, this.cell * 0.78)

    this.setData({
      gold: this.data.gold - cost,
      spentGold: this.data.spentGold + cost,
      selectedTower: this.publicTower(tower),
      message: `${tower.name} 升到 Lv.${tower.level}`
    })
  },

  finishGame(overrides = {}) {
    if (this.data.gameOver) return

    const lives = typeof overrides.lives === 'number' ? overrides.lives : this.data.lives
    const escaped = typeof overrides.escaped === 'number' ? overrides.escaped : this.data.escaped
    const stats = {
      wave: this.data.wave,
      clearedWaves: this.data.running ? Math.max(0, this.data.wave - 1) : this.data.wave,
      kills: this.data.kills,
      escaped,
      earnedGold: this.data.earnedGold,
      spentGold: this.data.spentGold,
      towersBuilt: this.data.towersBuilt,
      finalGold: this.data.gold
    }

    this.spawnQueue = []
    this.setData({
      lives,
      escaped,
      running: false,
      gameOver: true,
      showGameOver: true,
      selectedTower: null,
      gameOverStats: stats,
      message: '城门失守，游戏结束'
    })
  },

  restartGame() {
    this.lastTick = Date.now()
    this.resetGame()
    this.draw()
  },

  startWave() {
    if (this.data.running || this.data.gameOver) return
    const nextWave = this.data.wave + 1
    const count = 7 + nextWave * 3
    const hpMultiplier = 1 + (nextWave - 1) * 0.34
    this.spawnQueue = Array.from({ length: count }, (_, index) => ({
      hp: Math.round((48 + nextWave * 18 + Math.floor(index / 4) * (8 + nextWave * 2)) * hpMultiplier),
      speed: 0.035 + nextWave * 0.002,
      reward: 8 + Math.floor(nextWave / 2)
    }))
    this.spawnTimer = 0
    this.setData({
      wave: nextWave,
      running: true,
      message: `第 ${nextWave} 轮敌人来袭`
    })
  },

  update(dt) {
    if (!this.map || !this.cell) return
    if (this.data.gameOver) {
      this.updateEffects(dt)
      return
    }
    if (this.data.running) {
      this.updateSpawns(dt)
    }
    this.updateEnemies(dt)
    if (this.data.gameOver) {
      this.updateEffects(dt)
      return
    }
    this.updateSoldiers(dt)
    this.updateTowers(dt)
    this.updateProjectiles(dt)
    this.updateEffects(dt)

    if (
      this.data.running &&
      this.spawnQueue.length === 0 &&
      this.enemies.length === 0
    ) {
      const bonus = 24 + this.data.wave * 4
      this.setData({
        running: false,
        gold: this.data.gold + bonus,
        earnedGold: this.data.earnedGold + bonus,
        message: `第 ${this.data.wave} 轮清理完毕`
      })
    }
  },

  updateSpawns(dt) {
    this.spawnTimer -= dt
    if (this.spawnTimer > 0 || this.spawnQueue.length === 0) return
    const config = this.spawnQueue.shift()
    const start = this.map.waypoints[0]
    this.enemies.push({
      id: `${Date.now()}-${Math.random()}`,
      x: start.x,
      y: start.y,
      hp: config.hp,
      maxHp: config.hp,
      speed: config.speed,
      reward: config.reward,
      waypoint: 1,
      slowTimer: 0,
      slowFactor: 1,
      blockedBy: null,
      hurtTimer: 0,
      age: 0,
      wobble: Math.random() * TWO_PI
    })
    this.createRingEffect(start.x, start.y, '#fbbf24', this.cell * 0.32)
    this.spawnTimer = Math.max(380, 980 - this.data.wave * 35)
  },

  updateEnemies(dt) {
    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      const enemy = this.enemies[i]
      if (enemy.hp <= 0) {
        this.enemies.splice(i, 1)
        this.releaseEnemyBlock(enemy)
        this.createDeathBurst(enemy)
        this.setData({
          gold: this.data.gold + enemy.reward,
          earnedGold: this.data.earnedGold + enemy.reward,
          kills: this.data.kills + 1
        })
        continue
      }
      enemy.age += dt
      enemy.hurtTimer = Math.max(0, enemy.hurtTimer - dt)

      if (enemy.slowTimer > 0) {
        enemy.slowTimer -= dt
      } else {
        enemy.slowFactor = 1
      }

      if (this.isEnemyBlocked(enemy)) {
        continue
      }

      const target = this.map.waypoints[enemy.waypoint]
      if (!target) {
        this.enemies.splice(i, 1)
        this.releaseEnemyBlock(enemy)
        this.createRingEffect(enemy.x, enemy.y, '#ef4444', this.cell * 0.38)
        const lives = Math.max(0, this.data.lives - 1)
        const escaped = this.data.escaped + 1
        if (lives <= 0) {
          this.finishGame({ lives, escaped })
        } else {
          this.setData({
            lives,
            escaped,
            running: this.data.running,
            message: '有敌人突破了防线'
          })
        }
        continue
      }

      const distance = this.distance(enemy, target)
      const step = enemy.speed * enemy.slowFactor * dt
      if (distance <= step) {
        enemy.x = target.x
        enemy.y = target.y
        enemy.waypoint += 1
      } else {
        enemy.x += ((target.x - enemy.x) / distance) * step
        enemy.y += ((target.y - enemy.y) / distance) * step
      }
    }
  },

  updateTowers(dt) {
    this.towers.forEach((tower) => {
      tower.fireTimer -= dt
      if (tower.fireTimer > 0) return
      if (tower.type === 'barracks') {
        this.updateBarracks(tower)
        return
      }

      const target = this.findEnemyInRange(tower, tower.range * this.cell)
      if (!target) return

      tower.fireTimer = tower.cooldown
      tower.recoilTimer = 140
      this.createMuzzleEffect(tower, target)
      this.projectiles.push({
        x: tower.x,
        y: tower.y,
        prevX: tower.x,
        prevY: tower.y,
        target,
        type: tower.type,
        damage: tower.damage,
        speed: tower.type === 'rocket' ? 0.32 : tower.type === 'magic' ? 0.62 : 0.54,
        splash: TOWER_TYPES[tower.type].splash ? TOWER_TYPES[tower.type].splash * this.cell : 0,
        slow: TOWER_TYPES[tower.type].slow || 0,
        color: TOWER_TYPES[tower.type].color,
        angle: Math.atan2(target.y - tower.y, target.x - tower.x),
        age: 0
      })
    })
  },

  updateBarracks(tower) {
    tower.fireTimer = tower.cooldown
    const maxSoldiers = Math.min(2 + tower.level, 5)
    const owned = this.soldiers.filter((soldier) => soldier.towerId === tower.id)
    owned.forEach((soldier) => this.syncSoldierWithTower(soldier, tower))
    if (owned.length < maxSoldiers) {
      const point = this.nearestPathInfo(tower)
      const stats = this.barracksSoldierStats(tower)
      this.soldiers.push({
        id: `${tower.id}-soldier-${Date.now()}-${Math.random()}`,
        towerId: tower.id,
        x: point.x,
        y: point.y,
        homeX: point.x,
        homeY: point.y,
        guardX: point.x,
        guardY: point.y,
        guardRadius: stats.guardRadius,
        pathIndex: point.index,
        patrolDir: 1,
        damage: stats.damage,
        range: stats.guardRadius,
        blockDistance: stats.blockDistance,
        moveSpeed: stats.moveSpeed,
        attackTimer: 0,
        attackCooldown: stats.attackCooldown,
        blockingEnemyId: null,
        swingTimer: 0,
        life: 999999999
      })
      this.createRingEffect(point.x, point.y, '#86efac', this.cell * 0.26)
    }
  },

  updateSoldiers(dt) {
    for (let i = this.soldiers.length - 1; i >= 0; i -= 1) {
      const soldier = this.soldiers[i]
      soldier.life -= dt
      soldier.attackTimer -= dt
      soldier.swingTimer = Math.max(0, soldier.swingTimer - dt)
      if (soldier.life <= 0) {
        this.releaseSoldierBlock(soldier)
        this.createRingEffect(soldier.x, soldier.y, '#86efac', this.cell * 0.18)
        this.soldiers.splice(i, 1)
        continue
      }

      const target = this.resolveSoldierTarget(soldier)
      const speed = soldier.moveSpeed || 0.075
      if (target) {
        const reached = this.moveToward(soldier, target, speed * dt, soldier.blockDistance || this.cell * 0.58)
        if (reached) {
          target.blockedBy = soldier.id
          soldier.blockingEnemyId = target.id
        }
      } else {
        this.releaseSoldierBlock(soldier)
        this.patrolSoldier(soldier, dt)
      }

      if (soldier.attackTimer > 0 || !target) continue
      if (target.blockedBy !== soldier.id) continue
      if (this.distance(soldier, target) > (soldier.blockDistance || this.cell * 0.58) + this.cell * 0.2) continue
      soldier.swingTimer = 180
      this.damageEnemy(target, soldier.damage, '#bbf7d0')
      this.effects.push({
        type: 'slash',
        x: target.x,
        y: target.y,
        age: 0,
        life: 180,
        color: '#bbf7d0',
        angle: Math.random() * Math.PI
      })
      soldier.attackTimer = soldier.attackCooldown || 680
    }
  },

  refreshBarracksSoldiers(tower) {
    if (tower.type !== 'barracks') return
    this.soldiers.forEach((soldier) => {
      if (soldier.towerId !== tower.id) return
      this.syncSoldierWithTower(soldier, tower)
      soldier.life = Math.max(soldier.life || 0, 999999999)
    })
  },

  syncSoldierWithTower(soldier, tower) {
    const stats = this.barracksSoldierStats(tower)
    soldier.damage = stats.damage
    soldier.range = stats.guardRadius
    soldier.guardRadius = stats.guardRadius
    soldier.blockDistance = stats.blockDistance
    soldier.moveSpeed = stats.moveSpeed
    soldier.attackCooldown = stats.attackCooldown
    if (typeof soldier.pathIndex !== 'number') {
      const point = this.nearestPathInfo(soldier)
      soldier.pathIndex = point.index
      soldier.homeX = point.x
      soldier.homeY = point.y
      soldier.guardX = point.x
      soldier.guardY = point.y
    }
    if (typeof soldier.guardX !== 'number') soldier.guardX = soldier.homeX
    if (typeof soldier.guardY !== 'number') soldier.guardY = soldier.homeY
    if (!soldier.patrolDir) soldier.patrolDir = 1
  },

  barracksSoldierStats(tower) {
    return {
      damage: Math.max(2, Math.round(tower.damage * SOLDIER_DAMAGE_RATIO)),
      guardRadius: (2.7 + tower.level * 0.36) * this.cell,
      blockDistance: Math.max(6, this.cell * 0.58),
      moveSpeed: 0.064 + tower.level * 0.006,
      attackCooldown: Math.max(520, 760 - tower.level * 35)
    }
  },

  resolveSoldierTarget(soldier) {
    const current = this.enemies.find((enemy) => enemy.id === soldier.blockingEnemyId)
    if (current && current.hp > 0 && this.isEnemyInSoldierZone(soldier, current)) {
      return current
    }
    this.releaseSoldierBlock(soldier)
    return this.findEnemyForSoldier(soldier)
  },

  findEnemyForSoldier(soldier) {
    let best = null
    let bestProgress = -1
    this.enemies.forEach((enemy) => {
      if (enemy.blockedBy && enemy.blockedBy !== soldier.id) return
      if (!this.isEnemyInSoldierZone(soldier, enemy)) return
      const progress = enemy.waypoint * 10000 + enemy.x + enemy.y
      if (progress > bestProgress) {
        best = enemy
        bestProgress = progress
      }
    })
    return best
  },

  isEnemyInSoldierZone(soldier, enemy) {
    const guard = {
      x: soldier.guardX || soldier.homeX || soldier.x,
      y: soldier.guardY || soldier.homeY || soldier.y
    }
    return this.distance(guard, enemy) <= (soldier.guardRadius || this.cell * 3)
  },

  isPointInSoldierZone(soldier, point) {
    const guard = {
      x: soldier.guardX || soldier.homeX || soldier.x,
      y: soldier.guardY || soldier.homeY || soldier.y
    }
    return this.distance(guard, point) <= (soldier.guardRadius || this.cell * 3)
  },

  isEnemyBlocked(enemy) {
    if (!enemy.blockedBy) return false
    const soldier = this.soldiers.find((item) => item.id === enemy.blockedBy)
    if (!soldier || soldier.blockingEnemyId !== enemy.id || !this.isEnemyInSoldierZone(soldier, enemy)) {
      enemy.blockedBy = null
      if (soldier && soldier.blockingEnemyId === enemy.id) {
        soldier.blockingEnemyId = null
      }
      return false
    }
    const closeEnough = this.distance(soldier, enemy) <= (soldier.blockDistance || this.cell * 0.58) + this.cell * 0.2
    if (!closeEnough) {
      enemy.blockedBy = null
      soldier.blockingEnemyId = null
    }
    return closeEnough
  },

  releaseSoldierBlock(soldier) {
    if (!soldier.blockingEnemyId) return
    const enemy = this.enemies.find((item) => item.id === soldier.blockingEnemyId)
    if (enemy && enemy.blockedBy === soldier.id) {
      enemy.blockedBy = null
    }
    soldier.blockingEnemyId = null
  },

  releaseEnemyBlock(enemy) {
    if (!enemy.blockedBy) return
    const soldier = this.soldiers.find((item) => item.id === enemy.blockedBy)
    if (soldier && soldier.blockingEnemyId === enemy.id) {
      soldier.blockingEnemyId = null
    }
    enemy.blockedBy = null
  },

  patrolSoldier(soldier, dt) {
    const waypoints = this.map.waypoints
    if (!waypoints.length) return
    if (typeof soldier.pathIndex !== 'number') {
      soldier.pathIndex = this.nearestPathInfo(soldier).index
    }

    const target = waypoints[soldier.pathIndex] || waypoints[0]
    const reached = this.moveToward(soldier, target, (soldier.moveSpeed || 0.075) * 0.72 * dt, this.cell * 0.08)
    if (!reached) return

    const forward = soldier.pathIndex + soldier.patrolDir
    const backward = soldier.pathIndex - soldier.patrolDir
    if (this.canSoldierPatrolTo(soldier, forward)) {
      soldier.pathIndex = forward
      return
    }
    soldier.patrolDir *= -1
    soldier.pathIndex = this.canSoldierPatrolTo(soldier, backward) ? backward : this.nearestPathInfo(soldier).index
  },

  canSoldierPatrolTo(soldier, index) {
    const point = this.map.waypoints[index]
    return !!point && this.isPointInSoldierZone(soldier, point)
  },

  moveToward(actor, target, step, stopDistance) {
    const distance = this.distance(actor, target)
    if (distance <= stopDistance) return true
    const travel = Math.min(step, distance - stopDistance)
    actor.x += ((target.x - actor.x) / distance) * travel
    actor.y += ((target.y - actor.y) / distance) * travel
    return distance - travel <= stopDistance + 0.5
  },

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i -= 1) {
      const projectile = this.projectiles[i]
      if (!this.enemies.includes(projectile.target)) {
        this.projectiles.splice(i, 1)
        continue
      }

      const distance = this.distance(projectile, projectile.target)
      const step = projectile.speed * dt
      if (distance <= step) {
        this.hitEnemy(projectile)
        this.projectiles.splice(i, 1)
      } else {
        projectile.prevX = projectile.x
        projectile.prevY = projectile.y
        projectile.x += ((projectile.target.x - projectile.x) / distance) * step
        projectile.y += ((projectile.target.y - projectile.y) / distance) * step
        projectile.angle = Math.atan2(projectile.target.y - projectile.y, projectile.target.x - projectile.x)
        projectile.age += dt
      }
    }
  },

  hitEnemy(projectile) {
    if (projectile.splash) {
      this.enemies.forEach((enemy) => {
        if (this.distance(enemy, projectile.target) <= projectile.splash) {
          this.damageEnemy(enemy, projectile.damage, projectile.color)
        }
      })
      this.effects.push({
        type: 'explosion',
        x: projectile.target.x,
        y: projectile.target.y,
        age: 0,
        life: 360,
        radius: projectile.splash,
        color: projectile.color
      })
    } else {
      this.damageEnemy(projectile.target, projectile.damage, projectile.color)
    }

    if (projectile.slow) {
      projectile.target.slowFactor = projectile.slow
      projectile.target.slowTimer = 1100
      this.effects.push({
        type: 'ring',
        x: projectile.target.x,
        y: projectile.target.y,
        age: 0,
        life: 420,
        radius: this.cell * 0.2,
        endRadius: this.cell * 0.72,
        color: '#c4b5fd'
      })
    }
  },

  damageEnemy(enemy, damage, color) {
    enemy.hp -= damage
    enemy.hurtTimer = 140
    this.effects.push({
      type: 'hit',
      x: enemy.x,
      y: enemy.y,
      age: 0,
      life: 220,
      radius: this.cell * 0.14,
      color
    })
  },

  updateEffects(dt) {
    this.towers.forEach((tower) => {
      tower.recoilTimer = Math.max(0, (tower.recoilTimer || 0) - dt)
    })

    for (let i = this.effects.length - 1; i >= 0; i -= 1) {
      const effect = this.effects[i]
      effect.age += dt
      if (effect.vx) {
        effect.x += effect.vx * dt
        effect.y += effect.vy * dt
        effect.vy += 0.0006 * dt
      }
      if (effect.age >= effect.life) {
        this.effects.splice(i, 1)
      }
    }
  },

  createMuzzleEffect(tower, target) {
    const color = TOWER_TYPES[tower.type].color
    this.effects.push({
      type: tower.type === 'magic' ? 'beam' : 'muzzle',
      x: tower.x,
      y: tower.y,
      toX: target.x,
      toY: target.y,
      angle: Math.atan2(target.y - tower.y, target.x - tower.x),
      age: 0,
      life: tower.type === 'magic' ? 180 : 130,
      radius: this.cell * 0.18,
      color
    })
  },

  createRingEffect(x, y, color, endRadius) {
    this.effects.push({
      type: 'ring',
      x,
      y,
      age: 0,
      life: 360,
      radius: this.cell * 0.08,
      endRadius,
      color
    })
  },

  createDeathBurst(enemy) {
    const baseColor = enemy.slowTimer > 0 ? '#7dd3fc' : '#fca5a5'
    this.effects.push({
      type: 'death',
      x: enemy.x,
      y: enemy.y,
      age: 0,
      life: 420,
      radius: this.cell * 0.24,
      color: baseColor
    })
    for (let i = 0; i < 9; i += 1) {
      const angle = (TWO_PI / 9) * i + Math.random() * 0.45
      const speed = 0.035 + Math.random() * 0.06
      this.effects.push({
        type: 'spark',
        x: enemy.x,
        y: enemy.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        age: 0,
        life: 380 + Math.random() * 180,
        radius: this.cell * (0.045 + Math.random() * 0.05),
        color: baseColor
      })
    }
  },

  findEnemyInRange(origin, range) {
    let best = null
    let bestProgress = -1
    this.enemies.forEach((enemy) => {
      if (this.distance(origin, enemy) > range) return
      const progress = enemy.waypoint * 10000 + enemy.x + enemy.y
      if (progress > bestProgress) {
        best = enemy
        bestProgress = progress
      }
    })
    return best
  },

  draw() {
    if (!this.ctx || !this.map || !this.cell) return
    const ctx = this.ctx
    ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight)
    ctx.setFillStyle('#162132')
    ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight)
    ctx.save()
    ctx.translate(this.offsetX, this.offsetY)
    this.drawGrid(ctx)
    this.drawPath(ctx)
    this.drawSelectedTowerRange(ctx)
    this.drawEffects(ctx, 'under')
    this.drawTowers(ctx)
    this.drawSoldiers(ctx)
    this.drawEnemies(ctx)
    this.drawProjectiles(ctx)
    this.drawEffects(ctx, 'over')
    ctx.restore()
    ctx.draw()
  },

  drawGrid(ctx) {
    for (let row = 0; row < GRID_ROWS; row += 1) {
      for (let col = 0; col < GRID_COLS; col += 1) {
        const isPath = this.map.blocked[`${col},${row}`]
        ctx.setFillStyle(isPath ? '#6b5b3d' : '#1f3a34')
        ctx.fillRect(col * this.cell + 1, row * this.cell + 1, this.cell - 2, this.cell - 2)
      }
    }
  },

  drawPath(ctx) {
    ctx.setStrokeStyle('#d8b56d')
    ctx.setLineWidth(Math.max(5, this.cell * 0.22))
    ctx.setLineCap('round')
    ctx.beginPath()
    this.map.waypoints.forEach((point, index) => {
      if (index === 0) {
        ctx.moveTo(point.x, point.y)
      } else {
        ctx.lineTo(point.x, point.y)
      }
    })
    ctx.stroke()
  },

  drawSelectedTowerRange(ctx) {
    const selected = this.data.selectedTower
    if (!selected) return
    const tower = this.towers.find((item) => item.id === selected.id)
    if (!tower) return

    ctx.setFillStyle('rgba(110, 231, 183, 0.08)')
    ctx.setStrokeStyle('rgba(110, 231, 183, 0.42)')
    ctx.setLineWidth(Math.max(2, this.cell * 0.035))
    ctx.beginPath()
    const radius = tower.type === 'barracks'
      ? this.barracksSoldierStats(tower).guardRadius
      : tower.range * this.cell
    const center = tower.type === 'barracks' ? this.nearestPathInfo(tower) : tower
    ctx.arc(center.x, center.y, radius, 0, TWO_PI)
    ctx.fill()
    ctx.stroke()
  },

  drawTowers(ctx) {
    this.towers.forEach((tower) => {
      const type = TOWER_TYPES[tower.type]
      const recoil = (tower.recoilTimer || 0) / 140
      const pulse = 1 + recoil * 0.12
      const tileX = tower.col * this.cell
      const tileY = tower.row * this.cell
      const towerSize = tower.size || TOWER_SIZE
      const visualSize = towerSize * this.cell
      const minLine = Math.max(1.2, this.cell * 0.05)

      ctx.setFillStyle('rgba(15, 23, 42, 0.92)')
      ctx.fillRect(tileX + this.cell * 0.08, tileY + this.cell * 0.08, visualSize - this.cell * 0.16, visualSize - this.cell * 0.16)
      ctx.setStrokeStyle(type.color)
      ctx.setLineWidth(minLine)
      ctx.beginPath()
      ctx.moveTo(tileX + this.cell * 0.16, tileY + this.cell * 0.16)
      ctx.lineTo(tileX + visualSize - this.cell * 0.16, tileY + this.cell * 0.16)
      ctx.lineTo(tileX + visualSize - this.cell * 0.16, tileY + visualSize - this.cell * 0.16)
      ctx.lineTo(tileX + this.cell * 0.16, tileY + visualSize - this.cell * 0.16)
      ctx.closePath()
      ctx.stroke()

      ctx.save()
      ctx.translate(tower.x, tower.y)
      if (ctx.scale) {
        ctx.scale(pulse, pulse)
      }
      ctx.setFillStyle('#0f172a')
      ctx.beginPath()
      ctx.arc(0, this.cell * 0.16, this.cell * 0.76, 0, TWO_PI)
      ctx.fill()
      ctx.setFillStyle(type.color)
      if (tower.type === 'arrow') {
        this.drawArrowTower(ctx, tower)
      } else if (tower.type === 'rocket') {
        this.drawRocketTower(ctx, tower)
      } else if (tower.type === 'barracks') {
        this.drawBarracksTower(ctx, tower)
      } else {
        this.drawMagicTower(ctx, tower)
      }
      ctx.restore()

      ctx.setFillStyle('rgba(15, 23, 42, 0.78)')
      ctx.beginPath()
      ctx.arc(tower.x, tower.y, this.cell * 0.34, 0, TWO_PI)
      ctx.fill()
      ctx.setFillStyle('#ffffff')
      this.setCanvasFont(ctx, this.cell * 0.46)
      if (ctx.setTextAlign) {
        ctx.setTextAlign('center')
      }
      if (ctx.setTextBaseline) {
        ctx.setTextBaseline('middle')
      }
      ctx.fillText(type.icon, tower.x, tower.y)

      ctx.setFillStyle('#ffffff')
      this.setCanvasFont(ctx, this.cell * 0.3)
      ctx.fillText(`Lv${tower.level}`, tower.x, tower.y + this.cell * 0.78)
    })
  },

  setCanvasFont(ctx, size) {
    const fontSize = Math.max(8, Math.floor(size))
    if (ctx.setFontSize) {
      ctx.setFontSize(fontSize)
    } else if (ctx.setFont) {
      ctx.setFont(`${fontSize}px sans-serif`)
    } else {
      ctx.font = `${fontSize}px sans-serif`
    }
  },

  drawArrowTower(ctx) {
    const s = this.cell * TOWER_SIZE
    ctx.setLineWidth(Math.max(1.2, s * 0.08))
    ctx.setStrokeStyle('#e2e8f0')
    ctx.beginPath()
    ctx.arc(0, 0, s * 0.28, -1.2, 1.2)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(-s * 0.18, -s * 0.24)
    ctx.lineTo(s * 0.2, 0)
    ctx.lineTo(-s * 0.18, s * 0.24)
    ctx.stroke()
    ctx.setFillStyle('#facc15')
    ctx.beginPath()
    ctx.arc(0, 0, s * 0.12, 0, TWO_PI)
    ctx.fill()
  },

  drawRocketTower(ctx) {
    const s = this.cell * TOWER_SIZE
    ctx.setFillStyle('#7c2d12')
    ctx.fillRect(-s * 0.25, -s * 0.22, s * 0.5, s * 0.44)
    ctx.setFillStyle('#f97316')
    ctx.beginPath()
    ctx.arc(0, -s * 0.05, s * 0.25, 0, TWO_PI)
    ctx.fill()
    ctx.setFillStyle('#fed7aa')
    ctx.fillRect(s * 0.06, -s * 0.1, s * 0.32, s * 0.13)
  },

  drawBarracksTower(ctx) {
    const s = this.cell * TOWER_SIZE
    ctx.setFillStyle('#14532d')
    ctx.fillRect(-s * 0.28, -s * 0.12, s * 0.56, s * 0.36)
    ctx.setFillStyle('#22c55e')
    ctx.beginPath()
    ctx.moveTo(-s * 0.34, -s * 0.1)
    ctx.lineTo(0, -s * 0.38)
    ctx.lineTo(s * 0.34, -s * 0.1)
    ctx.closePath()
    ctx.fill()
    ctx.setFillStyle('#dcfce7')
    ctx.fillRect(-s * 0.07, s * 0.02, s * 0.14, s * 0.22)
  },

  drawMagicTower(ctx) {
    const s = this.cell * TOWER_SIZE
    ctx.setFillStyle('#4c1d95')
    ctx.beginPath()
    ctx.moveTo(0, -s * 0.36)
    ctx.lineTo(s * 0.28, s * 0.25)
    ctx.lineTo(-s * 0.28, s * 0.25)
    ctx.closePath()
    ctx.fill()
    ctx.setFillStyle('#c4b5fd')
    ctx.beginPath()
    ctx.arc(0, -s * 0.15, s * 0.14, 0, TWO_PI)
    ctx.fill()
  },

  drawSoldiers(ctx) {
    this.soldiers.forEach((soldier) => {
      const lean = soldier.swingTimer > 0 ? Math.sin((soldier.swingTimer / 180) * Math.PI) * this.cell * 0.1 : 0
      const blockedEnemy = this.enemies.find((enemy) => enemy.id === soldier.blockingEnemyId)
      if (blockedEnemy) {
        ctx.setStrokeStyle('rgba(187, 247, 208, 0.7)')
        ctx.setLineWidth(Math.max(1.2, this.cell * 0.05))
        ctx.beginPath()
        ctx.moveTo(soldier.x, soldier.y)
        ctx.lineTo(blockedEnemy.x, blockedEnemy.y)
        ctx.stroke()
      }
      ctx.setFillStyle('#86efac')
      ctx.beginPath()
      ctx.arc(soldier.x + lean, soldier.y, this.cell * 0.15, 0, TWO_PI)
      ctx.fill()
      ctx.setStrokeStyle('#dcfce7')
      ctx.setLineWidth(Math.max(1, this.cell * 0.05))
      ctx.beginPath()
      ctx.moveTo(soldier.x, soldier.y)
      ctx.lineTo(soldier.x + this.cell * 0.22 + lean, soldier.y - this.cell * 0.08)
      ctx.stroke()
    })
  },

  drawEnemies(ctx) {
    this.enemies.forEach((enemy) => {
      const bob = Math.sin(enemy.age / 120 + enemy.wobble) * this.cell * 0.035
      const flash = enemy.hurtTimer > 0 && Math.floor(enemy.hurtTimer / 35) % 2 === 0
      ctx.setFillStyle(flash ? '#ffffff' : enemy.slowTimer > 0 ? '#7dd3fc' : '#ef4444')
      ctx.beginPath()
      ctx.arc(enemy.x, enemy.y + bob, this.cell * 0.22, 0, TWO_PI)
      ctx.fill()
      if (enemy.blockedBy) {
        ctx.setStrokeStyle('#bbf7d0')
        ctx.setLineWidth(Math.max(1.2, this.cell * 0.05))
        ctx.beginPath()
        ctx.arc(enemy.x, enemy.y + bob, this.cell * 0.3, 0, TWO_PI)
        ctx.stroke()
      }
      ctx.setFillStyle('#7f1d1d')
      ctx.beginPath()
      ctx.arc(enemy.x - this.cell * 0.08, enemy.y + bob - this.cell * 0.04, this.cell * 0.035, 0, TWO_PI)
      ctx.arc(enemy.x + this.cell * 0.08, enemy.y + bob - this.cell * 0.04, this.cell * 0.035, 0, TWO_PI)
      ctx.fill()

      const width = this.cell * 0.58
      const hpRatio = Math.max(0, enemy.hp / enemy.maxHp)
      ctx.setFillStyle('#111827')
      ctx.fillRect(enemy.x - width / 2, enemy.y - this.cell * 0.38, width, 4)
      ctx.setFillStyle('#22c55e')
      ctx.fillRect(enemy.x - width / 2, enemy.y - this.cell * 0.38, width * hpRatio, 4)
    })
  },

  drawProjectiles(ctx) {
    this.projectiles.forEach((projectile) => {
      ctx.setStrokeStyle(projectile.color)
      ctx.setLineWidth(projectile.type === 'rocket' ? Math.max(1.8, this.cell * 0.12) : Math.max(1.2, this.cell * 0.08))
      ctx.setLineCap('round')
      ctx.beginPath()
      ctx.moveTo(projectile.prevX, projectile.prevY)
      ctx.lineTo(projectile.x, projectile.y)
      ctx.stroke()

      ctx.save()
      ctx.translate(projectile.x, projectile.y)
      if (ctx.rotate) {
        ctx.rotate(projectile.angle)
      }
      if (projectile.type === 'arrow') {
        ctx.setStrokeStyle('#f8fafc')
        ctx.setLineWidth(Math.max(2, this.cell * 0.05))
        ctx.beginPath()
        ctx.moveTo(-this.cell * 0.24, 0)
        ctx.lineTo(this.cell * 0.18, 0)
        ctx.stroke()
        ctx.setFillStyle('#facc15')
        ctx.beginPath()
        ctx.moveTo(this.cell * 0.24, 0)
        ctx.lineTo(this.cell * 0.08, -this.cell * 0.08)
        ctx.lineTo(this.cell * 0.08, this.cell * 0.08)
        ctx.closePath()
        ctx.fill()
      } else if (projectile.type === 'rocket') {
        ctx.setFillStyle('#fb923c')
        ctx.fillRect(-this.cell * 0.22, -this.cell * 0.09, this.cell * 0.4, this.cell * 0.18)
        ctx.setFillStyle('#fef3c7')
        ctx.beginPath()
        ctx.moveTo(this.cell * 0.2, 0)
        ctx.lineTo(this.cell * 0.06, -this.cell * 0.1)
        ctx.lineTo(this.cell * 0.06, this.cell * 0.1)
        ctx.closePath()
        ctx.fill()
        ctx.setFillStyle('#facc15')
        ctx.beginPath()
        ctx.arc(-this.cell * 0.2, 0, this.cell * 0.08, 0, TWO_PI)
        ctx.fill()
      } else {
        ctx.setFillStyle('#c4b5fd')
        ctx.beginPath()
        ctx.arc(0, 0, this.cell * 0.14 + Math.sin(projectile.age / 70) * this.cell * 0.04, 0, TWO_PI)
        ctx.fill()
      }
      ctx.restore()
    })
  },

  drawEffects(ctx, layer) {
    this.effects.forEach((effect) => {
      const overLayer = effect.type !== 'ring'
      if ((layer === 'over') !== overLayer) return
      const ratio = Math.min(1, effect.age / effect.life)
      const alpha = Math.max(0, 1 - ratio)
      ctx.save()
      if (ctx.setGlobalAlpha) {
        ctx.setGlobalAlpha(alpha)
      }
      ctx.setStrokeStyle(effect.color)
      ctx.setFillStyle(effect.color)
      if (effect.type === 'ring') {
        const radius = effect.radius + (effect.endRadius - effect.radius) * ratio
        ctx.setLineWidth(Math.max(2, this.cell * 0.05 * alpha))
        ctx.beginPath()
        ctx.arc(effect.x, effect.y, radius, 0, TWO_PI)
        ctx.stroke()
      } else if (effect.type === 'muzzle') {
        ctx.translate(effect.x, effect.y)
        if (ctx.rotate) {
          ctx.rotate(effect.angle)
        }
        ctx.beginPath()
        ctx.moveTo(this.cell * 0.12, 0)
        ctx.lineTo(this.cell * 0.42 * (1 + ratio), -this.cell * 0.12 * alpha)
        ctx.lineTo(this.cell * 0.42 * (1 + ratio), this.cell * 0.12 * alpha)
        ctx.closePath()
        ctx.fill()
      } else if (effect.type === 'beam') {
        ctx.setLineWidth(Math.max(2, this.cell * 0.07 * alpha))
        ctx.beginPath()
        ctx.moveTo(effect.x, effect.y)
        ctx.lineTo(effect.toX, effect.toY)
        ctx.stroke()
      } else if (effect.type === 'explosion' || effect.type === 'death') {
        if (ctx.setGlobalAlpha) {
          ctx.setGlobalAlpha(alpha * 0.8)
        }
        ctx.beginPath()
        ctx.arc(effect.x, effect.y, effect.radius * (0.25 + ratio), 0, TWO_PI)
        ctx.fill()
        if (ctx.setGlobalAlpha) {
          ctx.setGlobalAlpha(alpha)
        }
        ctx.setLineWidth(Math.max(2, this.cell * 0.07))
        ctx.beginPath()
        ctx.arc(effect.x, effect.y, effect.radius * (0.45 + ratio), 0, TWO_PI)
        ctx.stroke()
      } else if (effect.type === 'hit') {
        ctx.setLineWidth(Math.max(2, this.cell * 0.05))
        ctx.beginPath()
        ctx.moveTo(effect.x - effect.radius * (1 + ratio), effect.y)
        ctx.lineTo(effect.x + effect.radius * (1 + ratio), effect.y)
        ctx.moveTo(effect.x, effect.y - effect.radius * (1 + ratio))
        ctx.lineTo(effect.x, effect.y + effect.radius * (1 + ratio))
        ctx.stroke()
      } else if (effect.type === 'slash') {
        ctx.translate(effect.x, effect.y)
        if (ctx.rotate) {
          ctx.rotate(effect.angle)
        }
        ctx.setLineWidth(Math.max(2, this.cell * 0.06))
        ctx.beginPath()
        ctx.arc(0, 0, this.cell * 0.34, -0.7, 0.7)
        ctx.stroke()
      } else if (effect.type === 'spark') {
        ctx.beginPath()
        ctx.arc(effect.x, effect.y, effect.radius, 0, TWO_PI)
        ctx.fill()
      }
      ctx.restore()
    })
  },

  publicTower(tower) {
    return {
      id: tower.id,
      name: tower.name,
      level: tower.level,
      damage: tower.damage,
      range: tower.range,
      upgradeCost: tower.upgradeCost
    }
  },

  nearestPathPoint(tower) {
    return this.nearestPathInfo(tower)
  },

  nearestPathInfo(origin) {
    let bestIndex = 0
    let bestDistance = Infinity
    this.map.waypoints.forEach((point, index) => {
      const distance = this.distance(origin, point)
      if (distance < bestDistance) {
        bestDistance = distance
        bestIndex = index
      }
    })
    const point = this.map.waypoints[bestIndex]
    return {
      x: point.x,
      y: point.y,
      index: bestIndex
    }
  },

  cellCenter(col, row) {
    const size = this.cell || 1
    return {
      x: col * size + size / 2,
      y: row * size + size / 2
    }
  },

  towerCenter(col, row) {
    const size = this.cell || 1
    return {
      x: (col + TOWER_SIZE / 2) * size,
      y: (row + TOWER_SIZE / 2) * size
    }
  },

  inGrid(col, row) {
    return col >= 0 && col < GRID_COLS && row >= 0 && row < GRID_ROWS
  },

  distance(a, b) {
    const dx = a.x - b.x
    const dy = a.y - b.y
    return Math.sqrt(dx * dx + dy * dy)
  },

  randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min
  }
})
