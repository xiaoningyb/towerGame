App({
  onLaunch() {
    if (!wx.setInnerAudioOption) return
    wx.setInnerAudioOption({
      mixWithOther: true,
      obeyMuteSwitch: false
    })
  }
})
