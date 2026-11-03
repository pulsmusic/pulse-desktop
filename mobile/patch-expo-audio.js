// Доработки нативного плеера expo-audio для «Пульса» (применяются в CI перед сборкой APK):
//  1) «будильник» сети и процессора, пока играет музыка (WAKE_MODE_NETWORK) — при выключенном экране телефон
//     не засыпает между треками, и следующий трек включается;
//  2) кнопки «назад» и «вперёд» в шторке и на экране блокировки — нажатия уходят в приложение (событие remote);
//  3) пауза, когда отключили наушники.
// Если код expo-audio поменялся и замена не нашлась — сборка останавливается с понятной ошибкой.
const fs = require('fs'); const path = require('path');
const root = path.join(process.argv[2] || '.', 'node_modules/expo-audio/android/src/main/java/expo/modules/audio');
function edit(file, pairs) {
  const p = path.join(root, file); let t = fs.readFileSync(p, 'utf8');
  for (const [a, b] of pairs) { if (!t.includes(a)) throw new Error('patch-expo-audio: не нашёл в ' + file + ':\n' + a); t = t.replace(a, b); }
  fs.writeFileSync(p, t); console.log('patch-expo-audio:', file, 'ok');
}
edit('AudioPlayer.kt', [
  ['    .setAudioAttributes(AudioAttributes.DEFAULT, false)\n', '    .setAudioAttributes(AudioAttributes.DEFAULT, false)\n    .setWakeMode(C.WAKE_MODE_NETWORK)\n    .setHandleAudioBecomingNoisy(true)\n'],
  ['  fun setActiveForLockScreen(', `  // кнопка из шторки / экрана блокировки → в приложение (поле remote в статусе плеера)
  fun sendRemote(cmd: String) {
    playerScope.launch { sendPlayerUpdate(mapOf("remote" to cmd, "remoteAt" to System.currentTimeMillis().toDouble())) }
  }

  fun setActiveForLockScreen(`],
]);
edit('service/AudioControlsService.kt', [
  ['    // Add play/pause button (always present)\n', `    customLayout.add(
      CommandButton.Builder(CommandButton.ICON_PREVIOUS)
        .setDisplayName("Previous")
        .setEnabled(true)
        .setSessionCommand(SessionCommand(ACTION_PREV, Bundle.EMPTY))
        .build()
    )
    // Add play/pause button (always present)
`],
  ['    session.setCustomLayout(customLayout)\n', `    customLayout.add(
      CommandButton.Builder(CommandButton.ICON_NEXT)
        .setDisplayName("Next")
        .setEnabled(true)
        .setSessionCommand(SessionCommand(ACTION_NEXT, Bundle.EMPTY))
        .build()
    )
    session.setCustomLayout(customLayout)
`],
  ['    const val ACTION_SEEK_FORWARD = ', '    const val ACTION_NEXT = "expo.modules.audio.action.NEXT"\n    const val ACTION_PREV = "expo.modules.audio.action.PREV"\n    const val ACTION_SEEK_FORWARD = '],
  ['  override fun onGetSession(', '  fun remote(cmd: String) { currentPlayer?.sendRemote(cmd) }\n\n  override fun onGetSession('],
  // Кнопки в самом уведомлении (назад · пауза/пуск · вперёд). Android 13+ рисует плеер по данным сессии, а более
  // старые Android и оболочки (Huawei EMUI / HarmonyOS, MIUI) — по кнопкам уведомления. В expo-audio их не было вовсе,
  // поэтому там шторка показывала «ничего не играет» и без управления.
  ['    builder.setStyle(MediaStyleNotificationHelper.MediaStyle(session))\n', `    val pi = { action: String, code: Int -> PendingIntent.getService(this, code, Intent(this, AudioControlsService::class.java).setAction(action), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE) }
    builder.addAction(android.R.drawable.ic_media_previous, "Previous", pi(ACTION_PREV, 11))
    builder.addAction(if (lastPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play, if (lastPlaying) "Pause" else "Play", pi(ACTION_TOGGLE, 12))
    builder.addAction(android.R.drawable.ic_media_next, "Next", pi(ACTION_NEXT, 13))
    builder.setOngoing(lastPlaying)
    builder.setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
    builder.setStyle(MediaStyleNotificationHelper.MediaStyle(session).setShowActionsInCompactView(0, 1, 2))
`],
  ['      ACTION_TOGGLE -> withPlayerOnAppThread { player ->', '      ACTION_NEXT -> remote("next")\n      ACTION_PREV -> remote("prev")\n      ACTION_TOGGLE -> withPlayerOnAppThread { player ->'],
  ['  private var playbackListener: Player.Listener? = null\n', '  private var playbackListener: Player.Listener? = null\n  @Volatile private var lastPlaying = false   // играет ли сейчас (для кнопки в уведомлении; читается из любого потока)\n'],
  ['      updateSessionCustomLayout(player.ref.isPlaying)\n', '      lastPlaying = player.ref.isPlaying\n      updateSessionCustomLayout(player.ref.isPlaying)\n'],
  ['        override fun onIsPlayingChanged(isPlaying: Boolean) {\n', '        override fun onIsPlayingChanged(isPlaying: Boolean) {\n          lastPlaying = isPlaying\n'],
]);
edit('service/AudioMediaSessionCallback.kt', [
  ['            .add(SessionCommand(AudioControlsService.ACTION_SEEK_FORWARD, Bundle.EMPTY))\n', '            .add(SessionCommand(AudioControlsService.ACTION_SEEK_FORWARD, Bundle.EMPTY))\n            .add(SessionCommand(AudioControlsService.ACTION_NEXT, Bundle.EMPTY))\n            .add(SessionCommand(AudioControlsService.ACTION_PREV, Bundle.EMPTY))\n'],
  ['      AudioControlsService.ACTION_SEEK_FORWARD -> {', '      AudioControlsService.ACTION_NEXT -> AudioControlsService.getInstance()?.remote("next")\n      AudioControlsService.ACTION_PREV -> AudioControlsService.getInstance()?.remote("prev")\n      AudioControlsService.ACTION_SEEK_FORWARD -> {'],
]);
