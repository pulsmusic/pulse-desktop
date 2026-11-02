// Небольшое своё меню вместо системного окна Android (фото профиля, плейлист, трек).
// Компактная карточка снизу экрана: заголовок, пункты со значками, «Отмена». Скругление 22, пункты 48 с отступом 6 →
// их скругление 16 (22 − 6). Появляется и уходит мягко (прозрачность + небольшой подъём), закрывается касанием
// мимо, кнопкой «Назад» или «Отменой». На iPhone остаётся системное меню (оно и так в стиле iOS).
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, Text, View, useWindowDimensions } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing, runOnJS } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useT, hap } from './ui';

export type MItem = { text: string; icon?: string; onPress: () => void; danger?: boolean };
type M = { title?: string; items: MItem[] };
let push: ((m: M) => void) | null = null;
export function openMenu(title: string | undefined, items: MItem[]) { if (push) push({ title, items }); }

const EO = Easing.bezier(0.22, 1, 0.36, 1);
export function MenuHost() {
  const T: any = useT(); const ins = useSafeAreaInsets(); const { width } = useWindowDimensions();
  const [m, setM] = useState<M | null>(null);
  const p = useSharedValue(0);
  useEffect(() => { push = (x) => { setM(x); p.value = 0; p.value = withTiming(1, { duration: 240, easing: EO }); }; return () => { push = null; }; }, []);
  const close = (then?: () => void) => {
    p.value = withTiming(0, { duration: 170, easing: Easing.out(Easing.quad) }, (f) => { if (f) runOnJS(setM)(null); });
    if (then) setTimeout(then, 120);   // действие — когда меню уже уходит (окна выбора фото не налезают на него)
  };
  const bg = useAnimatedStyle(() => ({ opacity: p.value }));
  const card = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ translateY: (1 - p.value) * 24 }, { scale: 0.97 + 0.03 * p.value }] }));
  if (!m) return null;
  const dk = !!T.dark; const ink = T.ink || (dk ? '#fff' : '#111');
  const cardBg = dk ? '#1d1c23' : '#ffffff'; const line = dk ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  const W = Math.min(width - 32, 360);
  const Row = ({ it, cancel }: { it?: MItem; cancel?: boolean }) => (
    <Pressable onPress={() => { hap('light'); close(cancel ? undefined : it!.onPress); }}
      style={({ pressed }) => ({ height: 48, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, backgroundColor: pressed ? line : 'transparent', justifyContent: cancel ? 'center' : 'flex-start' })}>
      {!cancel && !!it!.icon && <Ionicons name={it!.icon as any} size={20} color={it!.danger ? '#ff5a5f' : ink} />}
      <Text style={{ fontSize: 16, fontWeight: cancel ? '600' : '500', color: cancel ? (T.accentText || T.accent) : it!.danger ? '#ff5a5f' : ink }}>{cancel ? 'Отмена' : it!.text}</Text>
    </Pressable>
  );
  return (
    <Modal transparent visible animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={() => close()}>
      <Animated.View style={[{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.38)' }, bg]}>
        <Pressable style={{ flex: 1 }} onPress={() => close()} />
      </Animated.View>
      <Animated.View style={[{ position: 'absolute', left: (width - W) / 2, width: W, bottom: ins.bottom + 16 }, card]}>
        <View style={{ borderRadius: 22, backgroundColor: cardBg, padding: 6, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 24, elevation: 12 }}>
          {!!m.title && <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '600', color: T.ink3 || T.muted, textAlign: 'center', paddingTop: 8, paddingBottom: 6, paddingHorizontal: 12 }}>{m.title}</Text>}
          {m.items.map((it, i) => <Row key={i} it={it} />)}
        </View>
        <View style={{ height: 8 }} />
        <View style={{ borderRadius: 22, backgroundColor: cardBg, padding: 6, elevation: 12 }}><Row cancel /></View>
      </Animated.View>
    </Modal>
  );
}
