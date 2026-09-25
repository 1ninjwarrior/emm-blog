// Em&m Blog: sample content for the LOCAL preview only (index.html?demo, when there is no db).
// Never runs in the published artifact with a real database.
import { _localSeed, state } from './store.js';
import { todayKey, addDays } from './ui.js';

function gradient(w, h, a, b, label) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, a); g.addColorStop(1, b);
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  x.fillStyle = 'rgba(255,255,255,.35)';
  for (let i = 0; i < 9; i++) { x.beginPath(); x.arc(Math.random() * w, Math.random() * h, 20 + Math.random() * 70, 0, 6.283); x.fill(); }
  x.fillStyle = 'rgba(255,255,255,.9)';
  x.font = `700 ${Math.round(w / 9)}px Caveat, cursive`;
  x.textAlign = 'center';
  x.fillText(label, w / 2, h / 2);
  return 'demo:' + c.toDataURL('image/jpeg', 0.8);
}

export function seed() {
  if (!state.memory) return;
  const now = Date.now();
  const day = 86400000;
  const t = todayKey();
  _localSeed('boards', [
    { id: 'b1', name: 'Us two', emoji: '💖', look: 'pink', createdAt: now - 40 * day },
    { id: 'b2', name: 'Food', emoji: '🍰', look: 'brown', createdAt: now - 39 * day },
    { id: 'b3', name: 'Outfits', emoji: '👗', look: 'lavender', createdAt: now - 38 * day },
  ]);
  const photos = [
    ['#FFB8D1', '#FF7FAA', 'beach day', 800, 1000, 'b1'],
    ['#FFE3C8', '#E9A866', 'pancakes', 900, 700, 'b2'],
    ['#DCCBFF', '#A283D6', 'fit check', 700, 1050, 'b3'],
    ['#C8E0F3', '#6FA6D6', 'sky', 1000, 800, null],
    ['#CFE3CB', '#7FAF83', 'picnic', 800, 800, 'b1'],
    ['#FFD3B0', '#FF8DB7', 'sunset', 800, 1100, null],
  ];
  const posts = photos.map((p, i) => ({
    id: 'p' + i, kind: 'photo', assetId: gradient(p[3] / 2, p[4] / 2, p[0], p[1], p[2]), w: p[3] / 2, h: p[4] / 2,
    text: i % 2 ? '' : 'golden hour with you ♡', boardId: p[5], createdAt: now - i * day * 2, favorite: i === 1,
  }));
  posts.push({ id: 'legacy', kind: 'photo', assetId: gradient(400, 500, '#FFC9DC', '#F27AA7', 'legacy'), text: 'old decorated post', boardId: 'b1', createdAt: now - 20 * day, frame: 'polaroid', stickers: [{ e: '🌸', x: 20, y: 20, s: 14 }, { e: '🎀', x: 80, y: 75, s: 18 }] });
  posts.push({ id: 't1', kind: 'thought', text: 'iced strawberry matcha + a good book = perfect sunday', tint: 2, boardId: null, createdAt: now - 3 * day });
  posts.push({ id: 't2', kind: 'thought', text: 'note to self: drink water, text grandma, buy more hair clips', tint: 1, boardId: 'b1', createdAt: now - 9 * day });
  _localSeed('posts', posts);
  _localSeed('countdowns', [
    { id: 'c1', title: 'Our anniversary', emoji: '💞', date: addDays(t, 12).replace(/^\d{4}/, (y) => String(+y - 2)), yearly: true, createdAt: now },
    { id: 'c2', title: 'Beach trip', emoji: '🏖️', date: addDays(t, 30), yearly: false, createdAt: now },
    { id: 'c3', title: 'First date', emoji: '🌹', date: addDays(t, -200), yearly: false, createdAt: now },
  ]);
  _localSeed('diary', [0, 1, 2, 4, 5, 9].map((d, i) => ({
    id: 'd' + i, date: addDays(t, -d), mood: ['happy', 'loved', 'calm', 'excited', 'tired', 'grateful'][i], weather: ['sunny', 'cloudy', 'sunny', 'rainy', 'windy', 'sunny'][i],
    title: ['picnic in the park', 'movie night', 'slow sunday', 'rainy cafe', 'long day', 'farmers market'][i],
    body: 'We packed strawberries and little sandwiches and watched the clouds for hours. Best day ♡', photoIds: [], tags: i % 2 ? ['us'] : ['food', 'cozy'],
    createdAt: now - d * day, updatedAt: now - d * day, favorite: i === 1,
  })));
  _localSeed('recipes', [
    { id: 'r1', title: 'Strawberry pancakes', emoji: '🥞', photoId: null, servings: 2, prepMin: 10, cookMin: 15, ingredients: [{ id: 'i1', text: '1 1/2 cups flour', checked: false }, { id: 'i2', text: '2 eggs', checked: false }, { id: 'i3', text: '1 cup milk', checked: true }, { id: 'i4', text: '½ cup strawberries', checked: false }], steps: [{ id: 's1', text: 'Whisk everything together.' }, { id: 's2', text: 'Cook on a warm pan for 3 min per side.' }], notes: 'extra syrup!', tags: ['breakfast'], favorite: true, createdAt: now, updatedAt: now },
    { id: 'r2', title: 'Matcha latte', emoji: '🍵', photoId: null, servings: 1, prepMin: 5, cookMin: 0, ingredients: [{ id: 'i5', text: '1 tsp matcha', checked: false }, { id: 'i6', text: '1 cup oat milk', checked: false }], steps: [{ id: 's3', text: 'Whisk matcha with a splash of hot water.' }], notes: '', tags: ['drinks'], favorite: false, createdAt: now - day, updatedAt: now - day },
  ]);
  _localSeed('lists', [
    { id: 'l1', title: 'Groceries', emoji: '🛒', kind: 'shopping', color: '#FFC2D8', items: [{ id: 'a', text: 'strawberries', qty: '2', checked: false, sort: 0 }, { id: 'b', text: 'oat milk', qty: '', checked: false, sort: 1 }, { id: 'c', text: 'bread', qty: '', checked: true, sort: 2 }], createdAt: now - 5 * day, updatedAt: now, sort: 0 },
    { id: 'l2', title: 'Date ideas', emoji: '💌', kind: 'bucket', color: '#DCCBFF', items: [{ id: 'd', text: 'pottery class', qty: '', checked: false, sort: 0 }, { id: 'e', text: 'stargazing', qty: '', checked: true, sort: 1 }], createdAt: now - 4 * day, updatedAt: now, sort: 1 },
  ]);
}
