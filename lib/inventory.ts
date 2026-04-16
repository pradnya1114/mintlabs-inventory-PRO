export interface InventoryItem {
  id: string;
  name: string;
  quantity: number;
  cupboard: string;
  category: string;
  serialNumber?: string;
  modelNumber?: string;
  imei?: string;
  adapter?: string;
  cable?: string;
  sim?: string;
  box?: string;
  remark?: string;
  working?: string;
  eles?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface InventoryRequest {
  id: string;
  itemId?: string;
  itemName: string;
  userId: string;
  userName: string;
  userEmail: string;
  type: 'take' | 'return' | 'request';
  status: 'pending' | 'approved' | 'rejected' | 'completed';
  quantity: number;
  createdAt: string;
  updatedAt: string;
  note?: string;
}

export interface InventoryData {
  items: InventoryItem[];
  requests: InventoryRequest[];
  lastAction: string;
}

export const CUPBOARDS = ["1", "2", "3", "4", "5", "Viral Sir Cabin", "Omkar Sir"];

export const CATEGORIES = [
  "Master",
  "Phones and Tablets",
  "TV",
  "Laptops",
  "Sensors",
  "VR",
  "Stands",
  "Printers",
  "Keybord & Mouse",
  "Cables",
  "Power Banks & POWER ADAPTER ",
  "CAMERA",
  "Scanners",
  "Monitors",
  "Lights",
  "Hardware",
  "External Storage",
  "Stationery",
  "HOLOTUBE",
  "Wifi Router",
  "CIRCUIT BOX",
  "NOT USED",
  "Others"
];

export function generateId(cupboard: string, items: InventoryItem[]): string {
  const prefix = `C${cupboard}-`;
  const existingInCupboard = items
    .filter(item => item.id.startsWith(prefix))
    .map(item => {
      const parts = item.id.split('-');
      return parseInt(parts[parts.length - 1]);
    })
    .sort((a, b) => a - b);
  
  let nextNum = 1;
  if (existingInCupboard.length > 0) {
    nextNum = existingInCupboard[existingInCupboard.length - 1] + 1;
  }
  
  return `${prefix}${nextNum.toString().padStart(3, '0')}`;
}
