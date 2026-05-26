export const STEPS = [
  { id: 'request_sent',         label: 'Request', desc: 'Buyer → Seller',              color: 'primary'   },
  { id: 'payment_required',     label: '402',      desc: 'Seller → Buyer',              color: 'warning'   },
  { id: 'payment_signing',      label: 'Signing', desc: 'Algorand USDC tx',             color: 'secondary' },
  { id: 'payment_sent',         label: 'Payment', desc: 'Buyer → Facilitator → Seller', color: 'primary'   },
  { id: 'settlement_confirmed', label: 'Settled', desc: 'On-chain confirmed',           color: 'success'   },
  { id: 'success',              label: 'Data',    desc: 'Seller → Buyer',              color: 'success'   },
] as const;

export type StepId    = typeof STEPS[number]['id'];
export type StepColor = typeof STEPS[number]['color'];

const IS_MAINNET = import.meta.env.VITE_NETWORK === 'mainnet';
export const EXPLORER_BASE = IS_MAINNET
  ? 'https://lora.algokit.io/mainnet/transaction'
  : 'https://lora.algokit.io/testnet/transaction';
export const GITHUB_URL    = 'https://github.com/camohe90/x402';

export const CONDITION_ICON: Record<string, string> = {
  'Clear Sky':   '☀️',  'Mainly Clear': '🌤️', 'Partly Cloudy': '⛅', 'Overcast':       '☁️',
  'Foggy':       '🌫️', 'Drizzle':      '🌦️', 'Heavy Drizzle': '🌧️',
  'Light Rain':  '🌦️', 'Rain':         '🌧️', 'Heavy Rain':    '⛈️',
  'Light Snow':  '🌨️', 'Snow':         '❄️',  'Heavy Snow':    '❄️',
  'Showers':     '🌦️', 'Heavy Showers':'⛈️',  'Thunderstorm':  '⛈️', 'Windy': '💨',
};
