'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  Package, 
  Plus, 
  Search, 
  Trash2, 
  Edit3, 
  LayoutGrid, 
  AlertCircle, 
  Download, 
  LogOut,
  ChevronRight,
  ChevronDown,
  RefreshCcw,
  Box,
  Filter,
  Folder,
  FileText,
  LogIn,
  User,
  ArrowUpDown,
  CheckCircle,
  XCircle,
  Clock,
  ClipboardList,
  ArrowRightLeft
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { read, utils } from 'xlsx';
import { InventoryItem, InventoryRequest, InventoryData, CUPBOARDS, CATEGORIES, generateId } from '@/lib/inventory';
import { auth, db as defaultDb, storage as defaultStorage, isFirebaseConfigured, activeConfig, app, getStorage, FirebaseStorage, getFirestore, Firestore } from '@/firebase';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  User as FirebaseUser,
  UserInfo
} from 'firebase/auth';
import { 
  collection, 
  doc, 
  onSnapshot, 
  setDoc, 
  deleteDoc, 
  getDoc,
  getDocFromServer,
  query,
  orderBy,
  Timestamp,
  writeBatch,
  updateDoc
} from 'firebase/firestore';
import { ref, uploadString, listAll, getDownloadURL, deleteObject } from 'firebase/storage';

// Error Handling Enums and Interfaces
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map((provider: UserInfo) => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "Something went wrong.";
      try {
        const parsed = JSON.parse(this.state.error?.message || "{}");
        if (parsed.error) {
          errorMessage = `Database Error: ${parsed.error}`;
        }
      } catch (e) {
        errorMessage = this.state.error?.message || errorMessage;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-red-50 p-4">
          <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full border border-red-100">
            <div className="w-12 h-12 bg-red-100 text-red-600 rounded-xl flex items-center justify-center mb-4">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Application Error</h2>
            <p className="text-gray-600 text-sm mb-6">{errorMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full bg-red-600 text-white p-3 rounded-xl font-bold hover:bg-red-700 transition-all"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function InventoryPageWrapper() {
  return (
    <ErrorBoundary>
      <InventoryPage />
    </ErrorBoundary>
  );
}

interface ExportFile {
  name: string;
  url: string;
}

function InventoryPage() {
  const [data, setData] = useState<InventoryData>({ items: [], requests: [], lastAction: 'Initializing...' });
  const [effectiveStorage, setEffectiveStorage] = useState<FirebaseStorage | null>(defaultStorage);
  const [effectiveDb, setEffectiveDb] = useState<Firestore | null>(defaultDb);
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [loadStartTime] = useState(Date.now());
  const [showConfigWarning, setShowConfigWarning] = useState(false);
  const [status, setStatus] = useState('System Ready');
  const [exports, setExports] = useState<ExportFile[]>([]);
  const [confirmModal, setConfirmModal] = useState<{ message: string; onConfirm: () => void } | null>(null);
  
  // Sorting States
  const [sortBy, setSortBy] = useState<'name' | 'quantity' | 'updatedAt'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Request States
  const [requestModal, setRequestModal] = useState<{ item?: InventoryItem; type: 'take' | 'return' | 'request' } | null>(null);
  const [requestQuantity, setRequestQuantity] = useState(1);
  const [requestItemName, setRequestItemName] = useState('');
  const [requestNote, setRequestNote] = useState('');
  const [showRequests, setShowRequests] = useState(false);

  // Form States
  const [newItem, setNewItem] = useState({ 
    name: '', 
    quantity: 1, 
    cupboard: CUPBOARDS[0], 
    category: CATEGORIES[0],
    serialNumber: '',
    modelNumber: '',
    imei: '',
    adapter: '',
    cable: '',
    sim: '',
    box: '',
    remark: '',
    working: 'yes',
    eles: ''
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Master');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<InventoryItem | null>(null);
  const [importPreview, setImportPreview] = useState<InventoryItem[] | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  // Connection Timeout Monitor
  useEffect(() => {
    if (!isDataLoading) return;
    const timer = setTimeout(() => {
      if (isDataLoading) {
        setShowConfigWarning(true);
        setStatus('Connect timeout - checking config...');
      }
    }, 8000); // 8 seconds before warning
    return () => clearTimeout(timer);
  }, [isDataLoading]);

  // Auth Listener
  useEffect(() => {
    if (!isFirebaseConfigured || !auth) {
      setIsAuthReady(true);
      setStatus('Firebase not configured');
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
      if (u) {
        setIsAdmin(u.email?.toLowerCase() === 'pradnya@mintlabs.in');
        setStatus(`Logged in as ${u.displayName || u.email}`);
      } else {
        setIsAdmin(false);
        setStatus('Please log in');
      }
    });
    return () => unsubscribe();
  }, []);

  // Firestore Connection Test
  useEffect(() => {
    if (!isFirebaseConfigured || !effectiveDb) return;
    async function testConnection() {
      if (!effectiveDb) return;
      try {
        await getDocFromServer(doc(effectiveDb, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. ");
          setStatus('Database Offline - Check Config');
        }
      }
    }
    testConnection();
  }, []);

  // Firestore Listeners
  useEffect(() => {
    if (!isAuthReady || !user || !isFirebaseConfigured || !effectiveDb) return;

    const inventoryPath = 'inventory';
    const metadataPath = 'metadata';
    const requestsPath = 'requests';

    const unsubscribeInventory = onSnapshot(collection(effectiveDb, inventoryPath), (snapshot) => {
      console.log(`Inventory snapshot received: ${snapshot.size} items`);
      const items = snapshot.docs.map(doc => doc.data() as InventoryItem);
      setData(prev => ({ ...prev, items }));
      setIsDataLoading(false);
      setStatus('Data Synchronized');
    }, (error) => {
      console.error('Inventory snapshot error:', error);
      setIsDataLoading(false);
      handleFirestoreError(error, OperationType.GET, inventoryPath);
    });

    const unsubscribeMetadata = onSnapshot(doc(effectiveDb, metadataPath, 'app'), (docSnap) => {
      if (docSnap.exists()) {
        const metadata = docSnap.data();
        setData(prev => ({ ...prev, lastAction: metadata.lastAction || 'No recent actions' }));
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `${metadataPath}/app`);
    });

    const unsubscribeRequests = onSnapshot(collection(effectiveDb, requestsPath), (snapshot) => {
      const requests = snapshot.docs.map(doc => doc.data() as InventoryRequest);
      setData(prev => ({ ...prev, requests }));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, requestsPath);
    });

    return () => {
      unsubscribeInventory();
      unsubscribeMetadata();
      unsubscribeRequests();
    };
  }, [isAuthReady, user, effectiveDb]);

  const fetchExports = useCallback(async () => {
    if (!isFirebaseConfigured || !effectiveStorage || !isAdmin) return;
    try {
      const exportsRef = ref(effectiveStorage, 'exports');
      const res = await listAll(exportsRef);
      const filePromises = res.items.map(async (item) => {
        const url = await getDownloadURL(item);
        return { name: item.name, url };
      });
      const files = await Promise.all(filePromises);
      setExports(files.sort((a, b) => b.name.localeCompare(a.name)));
    } catch (err: any) {
      console.error('Failed to fetch exports:', err);
      if (err?.code === 'storage/retry-limit-exceeded') {
        const altBucket = activeConfig.storageBucket?.includes('firebasestorage.app') 
          ? `${activeConfig.projectId}.appspot.com` 
          : `${activeConfig.projectId}.firebasestorage.app`;
        
        // AUTO-FIX: Attempt to switch to the other likely bucket
        console.warn(`Storage timeout with ${activeConfig.storageBucket}. Trying auto-recovery with ${altBucket}...`);
        try {
          const newStorage = getStorage(app, altBucket);
          setEffectiveStorage(newStorage);
          activeConfig.storageBucket = altBucket; // Update shared config for display
        } catch (recoveryErr) {
          console.error('Auto-recovery bucket switch failed:', recoveryErr);
        }

        setStatus(`Storage Timeout (Bucket: ${activeConfig.storageBucket}). 
          1. Enable Storage at https://console.firebase.google.com/project/${activeConfig.projectId}/storage 
          2. Trying auto-recovery bucket: ${altBucket}`);
      }
    }
  }, [isAdmin, effectiveStorage]);

  useEffect(() => {
    if (isAdmin) {
      void (async () => {
        await fetchExports();
      })();
    }
  }, [isAdmin, fetchExports]);

  const handleLogin = useCallback(async () => {
    if (!isFirebaseConfigured || !auth) {
      setStatus('Firebase not configured');
      return;
    }
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Login failed:', error);
      setStatus('Login Failed');
    }
  }, []);

  const handleLogout = useCallback(async () => {
    if (!isFirebaseConfigured || !auth) return;
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Logout failed:', error);
    }
  }, []);

  const updateLastAction = useCallback(async (action: string) => {
    const path = 'metadata/app';
    if (!effectiveDb) return;
    try {
      await setDoc(doc(effectiveDb, 'metadata', 'app'), {
        lastAction: action,
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }, [effectiveDb]);

  const handleAddItem = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItem.name || newItem.quantity < 1) return;
    if (!isFirebaseConfigured || !effectiveDb) {
      setStatus('Firebase not configured or no database connection');
      return;
    }

    const id = generateId(newItem.cupboard, data.items);
    const item: InventoryItem = { 
      ...newItem, 
      id,
      updatedAt: new Date().toISOString(),
      updatedBy: user?.uid
    };
    
    const path = `inventory/${id}`;
    try {
      await setDoc(doc(effectiveDb, 'inventory', id), item);
      await updateLastAction(`Added item: ${item.name} (${id})`);
      setNewItem({ 
        name: '', 
        quantity: 1, 
        cupboard: selectedCategory === 'Master' ? CUPBOARDS[0] : newItem.cupboard, 
        category: selectedCategory === 'Master' ? CATEGORIES[1] : selectedCategory,
        serialNumber: '',
        modelNumber: '',
        imei: '',
        adapter: '',
        cable: '',
        sim: '',
        box: '',
        remark: '',
        working: 'yes',
        eles: ''
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  }, [newItem, data.items, user?.uid, selectedCategory, updateLastAction]);

  const handleDeleteItem = useCallback((id: string) => {
    setConfirmModal({
      message: `Are you sure you want to delete item ${id}?`,
      onConfirm: async () => {
        if (!effectiveDb) return;
        const path = `inventory/${id}`;
        try {
          await deleteDoc(doc(effectiveDb, 'inventory', id));
          await updateLastAction(`Deleted item: ${id}`);
          setConfirmModal(null);
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, path);
        }
      }
    });
  }, [updateLastAction, effectiveDb]);

  const handleEditStart = useCallback((item: InventoryItem) => {
    setEditingId(item.id);
    setEditForm({
      ...item,
      imei: item.imei || '',
      adapter: item.adapter || '',
      cable: item.cable || '',
      sim: item.sim || '',
      box: item.box || '',
      remark: item.remark || '',
      working: item.working || 'yes',
      eles: item.eles || ''
    });
  }, []);

  const handleEditSave = useCallback(async () => {
    if (!editForm || !isFirebaseConfigured || !effectiveDb) return;
    const path = `inventory/${editForm.id}`;
    try {
      const updatedItem = {
        ...editForm,
        updatedAt: new Date().toISOString(),
        updatedBy: user?.uid
      };
      await setDoc(doc(effectiveDb, 'inventory', editForm.id), updatedItem);
      await updateLastAction(`Updated item: ${editForm.name} (${editForm.id})`);
      setEditingId(null);
      setEditForm(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }, [editForm, user, updateLastAction, effectiveDb]);

  const handleClearAll = useCallback(() => {
    setConfirmModal({
      message: 'CRITICAL: Are you sure you want to clear ALL inventory? This cannot be undone.',
      onConfirm: async () => {
        if (!effectiveDb) return;
        const batch = writeBatch(effectiveDb);
        data.items.forEach(item => {
          batch.delete(doc(effectiveDb, 'inventory', item.id));
        });
        try {
          await batch.commit();
          await updateLastAction('Inventory Cleared');
          setConfirmModal(null);
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, 'inventory (batch delete)');
        }
      }
    });
  }, [data.items, updateLastAction, effectiveDb]);

  const exportToCSV = useCallback(async () => {
    if (!isFirebaseConfigured || !effectiveStorage) {
      setStatus('Firebase not configured');
      return;
    }
    const headers = ['ID', 'Name', 'Quantity', 'Cupboard', 'Category', 'Serial Number', 'Model Number', 'IMEI', 'Adapter', 'Cable', 'Sim', 'Box', 'Remark', 'Working', 'Eles'];
    const rows = data.items.map(i => [
      i.id, 
      i.name, 
      i.quantity, 
      i.cupboard, 
      i.category, 
      i.serialNumber || '', 
      i.modelNumber || '',
      i.imei || '',
      i.adapter || '',
      i.cable || '',
      i.sim || '',
      i.box || '',
      i.remark || '',
      i.working || '',
      i.eles || ''
    ]);
    const csvContent = [headers, ...rows].map(e => e.map(val => `"${val}"`).join(",")).join("\n");
    
    // Save to browser (Download)
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    const fileName = `inventory_export_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
    link.setAttribute("href", url);
    link.setAttribute("download", fileName);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Save to Firebase Storage
    try {
      const storageRef = ref(effectiveStorage!, `exports/${fileName}`);
      await uploadString(storageRef, csvContent, 'raw', {
        contentType: 'text/csv'
      });
      
      setStatus(`Inventory exported and saved to storage: ${fileName}`);
      await updateLastAction(`Exported inventory to ${fileName}`);
      fetchExports();
    } catch (error: any) {
      console.error('Storage export failed:', error);
      if (error?.code === 'storage/retry-limit-exceeded') {
        const altBucket = activeConfig.storageBucket?.includes('firebasestorage.app') 
          ? `${activeConfig.projectId}.appspot.com` 
          : `${activeConfig.projectId}.firebasestorage.app`;

        setStatus(`Export Timeout (Bucket: ${activeConfig.storageBucket}). 
          1. Enable Storage at https://console.firebase.google.com/project/${activeConfig.projectId}/storage 
          2. Trying auto-recovery bucket: ${altBucket}`);
      } else {
        setStatus('Export failed');
      }
    }
  }, [data.items, fetchExports, updateLastAction, effectiveStorage]);

  const handleRequest = useCallback(async () => {
    if (!user || !requestModal) return;
    
    const { item, type } = requestModal;
    const quantity = requestQuantity;
    const note = requestNote;
    const itemName = item ? item.name : requestItemName;
    
    if (!itemName) return;
    
    const requestId = `REQ-${Date.now()}`;
    const newRequest: InventoryRequest = {
      id: requestId,
      itemId: item?.id,
      itemName,
      userId: user.uid,
      userName: user.displayName || 'Anonymous',
      userEmail: user.email || '',
      type,
      status: 'pending',
      quantity,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      note
    };

    try {
      await setDoc(doc(effectiveDb!, 'requests', requestId), newRequest);
      await updateLastAction(`Request to ${type} ${quantity}x ${itemName} submitted`);
      setStatus(`Request submitted successfully`);
      setRequestModal(null);
      setRequestQuantity(1);
      setRequestNote('');
      setRequestItemName('');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `requests/${requestId}`);
    }
  }, [user, requestModal, requestQuantity, requestNote, requestItemName, updateLastAction, effectiveDb]);

  const handleApproveRequest = useCallback(async (request: InventoryRequest) => {
    if (!isAdmin || !effectiveDb) return;
    const currentDb = effectiveDb;

    try {
      if (request.type === 'request') {
        // Just approve the request for a new item
        await updateDoc(doc(currentDb, 'requests', request.id), {
          status: 'approved',
          updatedAt: new Date().toISOString()
        });
        await updateLastAction(`Approved new item request for ${request.itemName}`);
        setStatus(`Request approved`);
        return;
      }

      if (!request.itemId) {
        setStatus('Error: Item ID missing');
        return;
      }

      const itemRef = doc(currentDb, 'inventory', request.itemId);
      const itemSnap = await getDoc(itemRef);
      
      if (!itemSnap.exists()) {
        setStatus('Error: Item not found');
        return;
      }

      const itemData = itemSnap.data() as InventoryItem;
      let newQuantity = itemData.quantity;

      if (request.type === 'take') {
        if (itemData.quantity < request.quantity) {
          setStatus('Error: Insufficient stock');
          return;
        }
        newQuantity -= request.quantity;
      } else if (request.type === 'return') {
        newQuantity += request.quantity;
      }

      // Update inventory
      await updateDoc(itemRef, {
        quantity: newQuantity,
        updatedAt: new Date().toISOString(),
        updatedBy: user?.uid
      });

      // Update request status
      await updateDoc(doc(currentDb, 'requests', request.id), {
        status: 'approved',
        updatedAt: new Date().toISOString()
      });

      await updateLastAction(`Approved ${request.type} request for ${request.itemName}`);
      setStatus(`Request approved`);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `requests/${request.id}`);
    }
  }, [isAdmin, user, updateLastAction, effectiveDb]);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = read(bstr, { type: 'binary' });
        let allParsedItems: InventoryItem[] = [];

        wb.SheetNames.forEach(wsname => {
          // Skip empty sheets or hidden ones if any
          const ws = wb.Sheets[wsname];
          const data = utils.sheet_to_json(ws) as any[];
          if (data.length === 0) return;

          const parsedItems: InventoryItem[] = data.map((row, index) => {
            // Mapping based on the provided image columns
            const name = (row['Inventory Description'] || row.name || row.Name || row.item || row.Item || row.Description || row.description || 'Unnamed Item').toString().trim();
            const quantityStr = String(row.Qy || row.quantity || row.Quantity || row.qty || row.Qty || row.Count || row.count || '0');
            const quantity = parseInt(quantityStr.replace(/[^0-9]/g, '')) || 0;
            const cupboard = String(row.Drawer || row.cupboard || row.Cupboard || row.Location || row.location || '1').trim();
            const serialNumber = String(row['Serial No'] || row['Serial No.'] || row.serialNumber || row.SerialNumber || row['Serial Number'] || row.SN || row.sn || '').trim();
            const modelNumber = String(row['Model/Make'] || row['Model'] || row.modelNumber || row.ModelNumber || row['Model Number'] || row.MN || row.mn || '').trim();
            
            // Normalize category
            let category = wsname === 'Master' ? (row.Category || row.category || row.CATEGORY || 'Master') : wsname.trim();
            const catLower = category.toLowerCase().trim();
            if (catLower === 'mouse' || catLower === 'keyboard & mouse') category = 'Keyboard & Mouse';
            else if (catLower === 'cable' || catLower === 'cables') category = 'Cables';
            else if (catLower === 'eles' || catLower === 'electronics') category = 'Electronics';
            else category = category.trim();

            // Generate a stable ID if none provided to prevent duplicates across sheets
            // We use a combination of name, serial, and model to create a unique but stable identifier
            const contentHash = `${name}-${serialNumber}-${modelNumber}`.toLowerCase().replace(/[^a-z0-9]/g, '');
            // IMPORTANT: Sanitize ID to remove forbidden Firestore characters like "/"
            let id = (row.Code || row.Inventory || row.id || row.ID || row['Asset ID'] || row.AssetID || `AUTO-${contentHash}`)
              .toString()
              .trim()
              .replace(/\//g, '_') // Replace forward slash with underscore
              .replace(/\s+/g, '-'); // Replace spaces with dashes
            
            if (!id) id = `AUTO-${Date.now()}-${index}`;

            return {
              id,
              name,
              quantity,
              cupboard,
              category,
              serialNumber,
              modelNumber,
              imei: String(row.IMEI || row.imei || row.Imei || '').trim(),
              adapter: String(row.Adapter || row.Adaptor || row.Adpator || row.adapter || row.adaptor || row.ADP || row.adp || '').trim(),
              cable: String(row.Cable || row.cable || row.CBL || row.cbl || '').trim(),
              sim: String(row.Sim || row.sim || row.SIM || '').trim(),
              box: String(row.Box || row.box || row.BOX || '').trim(),
              remark: String(row.Remark || row.remark || row.REMARK || row.Remarks || row.remarks || '').trim(),
              working: String(row.Working || row.working || row.STATUS || row.status || 'yes').trim(),
              eles: String(row.Eles || row.eles || '').trim(),
              updatedAt: new Date().toISOString(),
              updatedBy: user?.uid
            };
          });

          allParsedItems = [...allParsedItems, ...parsedItems];
        });

        // Deduplicate across all sheets by ID
        // If multiple sheets have the same item (same ID or same AUTO-ID), we keep the last one found
        const uniqueItemsMap = new Map<string, InventoryItem>();
        allParsedItems.forEach(item => {
          uniqueItemsMap.set(item.id, item);
        });
        
        const uniqueItems = Array.from(uniqueItemsMap.values());

        setImportPreview(uniqueItems);
        setStatus(`Parsed ${uniqueItems.length} unique items from ${wb.SheetNames.length} sheets`);
      } catch (error) {
        console.error('Excel parsing failed:', error);
        setStatus('Failed to parse Excel file');
      }
    };
    reader.readAsBinaryString(file);
    // Reset input
    e.target.value = '';
  }, [user]);

  const handleRemoveExport = useCallback(async (fileName: string) => {
    if (!isFirebaseConfigured || !effectiveStorage || !isAdmin) return;
    try {
      const storageRef = ref(effectiveStorage, `exports/${fileName}`);
      await deleteObject(storageRef);
      setStatus(`Export deleted: ${fileName}`);
      fetchExports();
    } catch (error) {
      console.error('Failed to delete export:', error);
      setStatus('Delete failed');
    }
  }, [isAdmin, fetchExports, effectiveStorage]);

  const handleConfirmImport = useCallback(async () => {
    if (!importPreview || !isAdmin || !isFirebaseConfigured || !effectiveDb) return;
    setIsImporting(true);
    const totalItems = importPreview.length;
    setStatus(`Preparing ${totalItems} items for upload...`);

    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("Import timed out after 60 seconds. Possible Database ID mismatch.")), 60000)
    );

    try {
      const BATCH_SIZE = 50; 
      const chunks = [];
      for (let i = 0; i < importPreview.length; i += BATCH_SIZE) {
        chunks.push(importPreview.slice(i, i + BATCH_SIZE));
      }

      console.log(`Starting batched import: ${chunks.length} batches for ${totalItems} items`);
      let processed = 0;
      
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const batchNum = i + 1;
          const totalBatches = chunks.length;
          
          setStatus(`Writing batch ${batchNum}/${totalBatches}...`);
          
          const currentDb = effectiveDb!;
          const batch = writeBatch(currentDb);
          
          // Use current user ID for the batch to ensure it's up to date
          const currentUid = auth.currentUser?.uid || user?.uid || 'unknown';
          
          chunk.forEach(item => {
            const itemRef = doc(currentDb, 'inventory', item.id);
            const cleanedItem = { 
              ...item,
              updatedBy: currentUid, // Force current UID at write time
              updatedAt: new Date().toISOString()
            };
            
            Object.keys(cleanedItem).forEach(key => {
              if ((cleanedItem as any)[key] === undefined) delete (cleanedItem as any)[key];
            });
            batch.set(itemRef, cleanedItem, { merge: true });
          });

          console.log(`Committing batch ${batchNum}/${totalBatches}...`);
          await Promise.race([
            batch.commit(), 
            new Promise((_, reject) => setTimeout(() => reject(new Error(`Batch ${batchNum} timed out`)), 25000))
          ]);
          
          processed += chunk.length;
          const progress = Math.round((processed / totalItems) * 100);
          setStatus(`Import progress: ${progress}% (Done ${processed}/${totalItems})`);
        }

      await updateLastAction(`Imported ${totalItems} items from Excel`);
      setStatus(`Successfully imported ${totalItems} items`);
      setImportPreview(null);
    } catch (error: any) {
      console.error('Import process failed:', error);
      setStatus(`Import failed: ${error?.message || 'Unknown error'}`);
    } finally {
      setIsImporting(false);
    }
  }, [importPreview, isAdmin, updateLastAction, effectiveDb]);

  const handleRejectRequest = useCallback(async (request: InventoryRequest) => {
    if (!isAdmin || !effectiveDb) return;

    try {
      await updateDoc(doc(effectiveDb, 'requests', request.id), {
        status: 'rejected',
        updatedAt: new Date().toISOString()
      });

      await updateLastAction(`Rejected ${request.type} request for ${request.itemName}`);
      setStatus(`Request rejected`);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `requests/${request.id}`);
    }
  }, [isAdmin, updateLastAction, effectiveDb]);

  const filteredItems = useMemo(() => {
    const items = data.items.filter(item => {
      const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           item.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           item.serialNumber?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           item.modelNumber?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = selectedCategory === 'Master' || item.category.trim().toLowerCase() === selectedCategory.trim().toLowerCase();
      return matchesSearch && matchesCategory;
    });

    // Deduplicate by content hash to prevent showing the same item multiple times
    const seen = new Set<string>();
    return items.filter(item => {
      const hash = `${item.name}-${item.serialNumber || ''}-${item.modelNumber || ''}`.toLowerCase().trim();
      if (seen.has(hash)) return false;
      seen.add(hash);
      return true;
    });
  }, [data.items, searchQuery, selectedCategory]);

  const sortedItems = useMemo(() => {
    return [...filteredItems].sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'name') {
        comparison = a.name.localeCompare(b.name);
      } else if (sortBy === 'quantity') {
        comparison = a.quantity - b.quantity;
      } else if (sortBy === 'updatedAt') {
        comparison = (a.updatedAt || '').localeCompare(b.updatedAt || '');
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }, [filteredItems, sortBy, sortOrder]);

  const stats = useMemo(() => {
    // Deduplicate items for accurate stats
    const seen = new Set<string>();
    const uniqueItems = data.items.filter(item => {
      const hash = `${item.name}-${item.serialNumber || ''}-${item.modelNumber || ''}`.toLowerCase().trim();
      if (seen.has(hash)) return false;
      seen.add(hash);
      return true;
    });

    const totalItems = uniqueItems.length;
    const totalQuantity = uniqueItems.reduce((acc, item) => acc + item.quantity, 0);
    const perCupboard = CUPBOARDS.reduce((acc, c) => {
      acc[c] = uniqueItems.filter(i => i.cupboard === c).length;
      return acc;
    }, {} as Record<string, number>);
    const perCategory = CATEGORIES.reduce((acc, cat) => {
      acc[cat] = uniqueItems.filter(i => i.category.trim().toLowerCase() === cat.trim().toLowerCase()).length;
      return acc;
    }, {} as Record<string, number>);
    return { totalItems, totalQuantity, perCupboard, perCategory };
  }, [data.items]);

  const isSwapped = useMemo(() => {
    if (!activeConfig.projectId || !activeConfig.databaseId) return false;
    const p = activeConfig.projectId.toLowerCase().trim();
    const d = activeConfig.databaseId.toLowerCase().trim();
    // Swapped if Project ID contains "ai-studio" (which is usually for databases) 
    // or if they are identical
    return p === d || p.includes('ai-studio-');
  }, []);

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-[#F5F5F4] flex items-center justify-center font-sans">
        <div className="flex flex-col items-center gap-4">
          <RefreshCcw className="w-8 h-8 text-blue-600 animate-spin" />
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Initializing System...</p>
        </div>
      </div>
    );
  }

  if (!isFirebaseConfigured) {
    return (
      <div className="min-h-screen bg-[#F5F5F4] flex items-center justify-center p-4 font-sans">
        <div className="bg-white border border-red-100 p-10 w-full max-w-md shadow-2xl rounded-2xl text-center">
          <div className="w-16 h-16 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mb-6 mx-auto">
            <AlertCircle className="w-8 h-8" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Configuration Required</h1>
          <p className="text-sm text-gray-500 mb-8">
            Firebase environment variables are missing. Please add your Firebase configuration to Vercel&apos;s environment variables to enable data persistence.
          </p>
          <div className="bg-gray-50 p-4 rounded-xl text-left border border-gray-100">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Required Variables:</p>
            <code className="text-[10px] text-gray-600 block space-y-1">
              NEXT_PUBLIC_FIREBASE_API_KEY<br />
              NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN<br />
              NEXT_PUBLIC_FIREBASE_PROJECT_ID
            </code>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#F5F5F4] flex items-center justify-center p-4 font-sans">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white border border-black/10 p-10 w-full max-w-md shadow-2xl rounded-2xl"
        >
          <div className="flex flex-col items-center mb-10 text-center">
            <div className="w-16 h-16 bg-blue-600 text-white rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-blue-200">
              <Box className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">Inventory Control</h1>
            <p className="text-sm text-gray-500 mt-1">Professional Asset Management System</p>
          </div>

          <div className="space-y-6">
            <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
              <p className="text-xs text-blue-700 leading-relaxed text-center">
                Welcome to the Mint Labs Inventory System. Please sign in with your corporate account to access the dashboard.
              </p>
            </div>

            <button 
              onClick={handleLogin}
              className="w-full bg-white border border-gray-200 text-gray-700 p-4 rounded-xl font-bold flex items-center justify-center gap-3 hover:bg-gray-50 transition-all shadow-sm active:scale-[0.98]"
            >
              <LogIn className="w-5 h-5 text-blue-600" />
              Sign in with Google
            </button>

            {typeof window !== 'undefined' && !window.location.hostname.includes('localhost') && (
              <p className="text-[10px] text-gray-400 text-center leading-relaxed mt-4">
                Note: If login fails, ensure <span className="text-gray-600 font-mono">{window.location.hostname}</span> is added to your Authorized Domains in Firebase Console.
              </p>
            )}
          </div>

          <div className="mt-8 flex items-center justify-center gap-2">
            <div className="h-px bg-gray-100 flex-1"></div>
            <span className="text-[10px] text-gray-400 uppercase font-bold tracking-widest">Authorized Only</span>
            <div className="h-px bg-gray-100 flex-1"></div>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F4] text-[#1A1A1A] font-sans flex flex-col">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-gray-100 p-4 px-8 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 text-white rounded-lg flex items-center justify-center shadow-md">
            <Box className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">Inventory Control</h1>
            <p className="text-[10px] text-gray-400 uppercase font-bold tracking-widest leading-none">System Active</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setRequestModal({ type: 'request' })}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg text-xs font-bold hover:bg-purple-700 transition-all active:scale-95 shadow-md shadow-purple-100"
          >
            <Plus className="w-4 h-4" /> New Request
          </button>
          <button 
            onClick={() => setShowRequests(!showRequests)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all active:scale-95 ${
              showRequests 
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-100' 
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            <ClipboardList className="w-4 h-4" /> 
            Requests
            {data.requests.filter(r => r.status === 'pending').length > 0 && (
              <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full ml-1">
                {data.requests.filter(r => r.status === 'pending').length}
              </span>
            )}
          </button>
          <button 
            onClick={exportToCSV}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-xs font-bold text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-all active:scale-95"
          >
            <Download className="w-4 h-4" /> Export CSV
          </button>
          {isAdmin && (
            <div className="relative">
              <input 
                type="file" 
                accept=".xlsx, .xls, .csv" 
                onChange={handleFileUpload}
                className="hidden" 
                id="excel-upload"
              />
              <label 
                htmlFor="excel-upload"
                className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-xs font-bold text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-all active:scale-95 cursor-pointer"
              >
                <FileText className="w-4 h-4 text-green-600" /> Import Excel
              </label>
            </div>
          )}
          <div className="h-6 w-px bg-gray-200 mx-1"></div>
          <button 
            onClick={handleLogout}
            className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg text-xs font-bold hover:bg-black transition-all active:scale-95 shadow-md"
          >
            <LogOut className="w-4 h-4" /> Logout
          </button>
        </div>
      </header>
      
      {/* Critical Configuration Warning Banner */}
      {(isSwapped || showConfigWarning) && (
        <div className="bg-red-600 text-white p-3 px-8 flex items-center justify-between shadow-lg z-50">
          <div className="flex items-center gap-4">
            <AlertCircle className="w-5 h-5 flex-shrink-0 animate-bounce" />
            <div className="text-xs font-bold uppercase tracking-wider">
              {isSwapped ? (
                <span>
                  CRITICAL: Possible Swapped IDs. PROJECT ID should be &quot;{activeConfig.expectedProjectId}&quot; but is &quot;{activeConfig.projectId}&quot;. 
                  Check Vercel env vars.
                </span>
              ) : (
                <span>WAITING FOR DATABASE CONNECT: This can happen if the DATABASE ID is incorrect in Vercel.</span>
              )}
            </div>
          </div>
          <button 
            onClick={() => setShowConfigWarning(false)}
            className="text-[10px] font-black uppercase tracking-widest bg-white/20 px-2 py-1 rounded hover:bg-white/30 transition-colors"
          >
            Dimiss
          </button>
        </div>
      )}

      {/* Category Navigation Bar */}
      <nav className="bg-white border-b border-gray-100 overflow-x-auto whitespace-nowrap sticky top-[73px] z-20 no-scrollbar px-8">
        <div className="flex items-center gap-2">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-5 py-4 text-[11px] uppercase font-bold transition-all relative group ${
                selectedCategory === cat 
                  ? 'text-blue-600' 
                  : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              {cat}
              {selectedCategory === cat && (
                <motion.div 
                  layoutId="activeTab"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600"
                />
              )}
            </button>
          ))}
        </div>
      </nav>

      <main className="flex-1 p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 max-w-[1800px] mx-auto w-full">
        {/* Left Panel: Controls */}
        <div className="lg:col-span-4 space-y-8">
          {/* Add Item Panel */}
          {isAdmin && (
            <section className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-6">
                <div className="w-8 h-8 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center">
                  <Plus className="w-4 h-4" />
                </div>
                <h2 className="text-sm font-bold text-gray-900 uppercase tracking-tight">Register Asset</h2>
              </div>
              <form onSubmit={handleAddItem} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-[10px] uppercase font-bold text-gray-400 mb-1.5 tracking-wider">Item Name</label>
                    <input 
                      type="text" 
                      required
                      className="w-full border border-gray-100 rounded-xl p-3 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 outline-none transition-all bg-gray-50/50"
                      value={newItem.name}
                      onChange={e => setNewItem({...newItem, name: e.target.value})}
                      placeholder="e.g. Dell Monitor P2419H"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-gray-400 mb-1.5 tracking-wider">Quantity</label>
                    <input 
                      type="number" 
                      min="1"
                      required
                      className="w-full border border-gray-100 rounded-xl p-3 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 outline-none transition-all bg-gray-50/50"
                      value={newItem.quantity}
                      onChange={e => setNewItem({...newItem, quantity: parseInt(e.target.value) || 0})}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-gray-400 mb-1.5 tracking-wider">Category</label>
                    <select 
                      className="w-full border border-gray-100 rounded-xl p-3 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 outline-none transition-all bg-gray-50/50"
                      value={newItem.category}
                      onChange={e => setNewItem({...newItem, category: e.target.value})}
                    >
                      {CATEGORIES.filter(c => c !== 'Master').map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-gray-400 mb-1.5 tracking-wider">Cupboard / Location</label>
                    <select 
                      className="w-full border border-gray-100 rounded-xl p-3 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 outline-none transition-all bg-gray-50/50"
                      value={newItem.cupboard}
                      onChange={e => setNewItem({...newItem, cupboard: e.target.value})}
                    >
                      {CUPBOARDS.map(c => <option key={c} value={c}>{c.length <= 2 ? `Cupboard ${c}` : c}</option>)}
                    </select>
                  </div>
                  <div className="col-span-1">
                    <label className="block text-[10px] uppercase font-bold text-gray-400 mb-1.5 tracking-wider">Serial Number</label>
                    <input 
                      type="text" 
                      className="w-full border border-gray-100 rounded-xl p-3 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 outline-none transition-all bg-gray-50/50"
                      value={newItem.serialNumber}
                      onChange={e => setNewItem({...newItem, serialNumber: e.target.value})}
                      placeholder="SN-XXXX"
                    />
                  </div>
                  <div className="col-span-1">
                    <label className="block text-[10px] uppercase font-bold text-gray-400 mb-1.5 tracking-wider">Model Number</label>
                    <input 
                      type="text" 
                      className="w-full border border-gray-100 rounded-xl p-3 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 outline-none transition-all bg-gray-50/50"
                      value={newItem.modelNumber}
                      onChange={e => setNewItem({...newItem, modelNumber: e.target.value})}
                      placeholder="MD-XXXX"
                    />
                  </div>
                  <div className="col-span-1">
                    <label className="block text-[10px] uppercase font-bold text-gray-400 mb-1.5 tracking-wider">IMEI</label>
                    <input 
                      type="text" 
                      className="w-full border border-gray-100 rounded-xl p-3 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 outline-none transition-all bg-gray-50/50"
                      value={newItem.imei || ''}
                      onChange={e => setNewItem({...newItem, imei: e.target.value})}
                      placeholder="IMEI-XXXX"
                    />
                  </div>
                  <div className="col-span-1">
                    <label className="block text-[10px] uppercase font-bold text-gray-400 mb-1.5 tracking-wider">Adapter</label>
                    <input 
                      type="text" 
                      className="w-full border border-gray-100 rounded-xl p-3 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 outline-none transition-all bg-gray-50/50"
                      value={newItem.adapter || ''}
                      onChange={e => setNewItem({...newItem, adapter: e.target.value})}
                      placeholder="Yes/No/Type"
                    />
                  </div>
                  <div className="col-span-1">
                    <label className="block text-[10px] uppercase font-bold text-gray-400 mb-1.5 tracking-wider">Cable</label>
                    <input 
                      type="text" 
                      className="w-full border border-gray-100 rounded-xl p-3 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 outline-none transition-all bg-gray-50/50"
                      value={newItem.cable || ''}
                      onChange={e => setNewItem({...newItem, cable: e.target.value})}
                      placeholder="Yes/No/Type"
                    />
                  </div>
                  <div className="col-span-1">
                    <label className="block text-[10px] uppercase font-bold text-gray-400 mb-1.5 tracking-wider">Sim</label>
                    <input 
                      type="text" 
                      className="w-full border border-gray-100 rounded-xl p-3 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 outline-none transition-all bg-gray-50/50"
                      value={newItem.sim || ''}
                      onChange={e => setNewItem({...newItem, sim: e.target.value})}
                      placeholder="Yes/No/Type"
                    />
                  </div>
                  <div className="col-span-1">
                    <label className="block text-[10px] uppercase font-bold text-gray-400 mb-1.5 tracking-wider">Box</label>
                    <input 
                      type="text" 
                      className="w-full border border-gray-100 rounded-xl p-3 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 outline-none transition-all bg-gray-50/50"
                      value={newItem.box || ''}
                      onChange={e => setNewItem({...newItem, box: e.target.value})}
                      placeholder="Yes/No"
                    />
                  </div>
                  <div className="col-span-1">
                    <label className="block text-[10px] uppercase font-bold text-gray-400 mb-1.5 tracking-wider">Eles</label>
                    <input 
                      type="text" 
                      className="w-full border border-gray-100 rounded-xl p-3 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 outline-none transition-all bg-gray-50/50"
                      value={newItem.eles || ''}
                      onChange={e => setNewItem({...newItem, eles: e.target.value})}
                      placeholder="Eles Info"
                    />
                  </div>
                  <div className="col-span-1">
                    <label className="block text-[10px] uppercase font-bold text-gray-400 mb-1.5 tracking-wider">Working Status</label>
                    <select 
                      className="w-full border border-gray-100 rounded-xl p-3 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 outline-none transition-all bg-gray-50/50"
                      value={newItem.working || 'yes'}
                      onChange={e => setNewItem({...newItem, working: e.target.value})}
                    >
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                      <option value="partial">Partial</option>
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[10px] uppercase font-bold text-gray-400 mb-1.5 tracking-wider">Remark</label>
                    <textarea 
                      className="w-full border border-gray-100 rounded-xl p-3 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 outline-none transition-all bg-gray-50/50 min-h-[60px] resize-none"
                      value={newItem.remark || ''}
                      onChange={e => setNewItem({...newItem, remark: e.target.value})}
                      placeholder="Any additional notes..."
                    />
                  </div>
                </div>
                <button 
                  type="submit"
                  className="w-full bg-blue-600 text-white p-4 rounded-xl font-bold text-sm uppercase tracking-wider hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 active:scale-[0.98] mt-2"
                >
                  Add to Inventory
                </button>
              </form>
            </section>
          )}

          {/* Search & Stats Panel */}
          <section className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-6">
              <div className="w-8 h-8 bg-gray-50 text-gray-600 rounded-lg flex items-center justify-center">
                <Search className="w-4 h-4" />
              </div>
              <h2 className="text-sm font-bold text-gray-900 uppercase tracking-tight">Control Center</h2>
            </div>
            <div className="space-y-6">
              <div className="relative">
                <input 
                  type="text" 
                  placeholder="Search assets..."
                  className="w-full border border-gray-100 rounded-xl p-3.5 pl-11 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 outline-none transition-all bg-gray-50/50"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
                <Search className="w-4 h-4 absolute left-4 top-4 text-gray-400" />
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 bg-gray-900 rounded-xl p-4 text-white flex justify-between items-center shadow-lg">
                  <div>
                    <p className="text-[9px] font-bold uppercase text-gray-400 tracking-widest mb-1">Total Assets</p>
                    <p className="text-2xl font-bold leading-none">{stats.totalItems}</p>
                  </div>
                  <div className="w-10 h-10 bg-white/10 rounded-lg flex items-center justify-center">
                    <LayoutGrid className="w-5 h-5 text-blue-400" />
                  </div>
                </div>
                <div className="col-span-2 bg-white border border-gray-100 rounded-xl p-4 flex justify-between items-center">
                  <div>
                    <p className="text-[9px] font-bold uppercase text-gray-400 tracking-widest mb-1">Total Units</p>
                    <p className="text-2xl font-bold leading-none text-gray-900">{stats.totalQuantity}</p>
                  </div>
                  <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
                    <RefreshCcw className="w-5 h-5 text-blue-600" />
                  </div>
                </div>

                <div className="col-span-2 pt-4 border-t border-gray-100">
                  <label className="block text-[10px] uppercase font-bold text-gray-400 mb-2 tracking-wider">Sort Inventory By</label>
                  <div className="flex gap-2">
                    <select 
                      className="flex-1 border border-gray-100 rounded-xl p-2.5 text-xs font-bold focus:border-blue-500 outline-none bg-gray-50/50"
                      value={sortBy}
                      onChange={e => setSortBy(e.target.value as any)}
                    >
                      <option value="name">Name</option>
                      <option value="quantity">Quantity</option>
                      <option value="updatedAt">Last Updated</option>
                    </select>
                    <button 
                      onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                      className="p-2.5 border border-gray-100 rounded-xl bg-gray-50/50 hover:bg-gray-100 transition-all active:scale-95"
                    >
                      <ArrowUpDown className={`w-4 h-4 text-gray-600 transition-transform ${sortOrder === 'desc' ? 'rotate-180' : ''}`} />
                    </button>
                  </div>
                </div>

                {CUPBOARDS.map(c => (
                  <div key={c} className="bg-gray-50/50 border border-gray-100 rounded-xl p-3 flex justify-between items-center">
                    <span className="text-[10px] font-bold text-gray-500 uppercase truncate max-w-[80px]">{c.length <= 2 ? `C${c}` : c}</span>
                    <span className="text-xs font-bold text-gray-900">{stats.perCupboard[c]}</span>
                  </div>
                ))}
              </div>

              {isAdmin && (
                <div className="space-y-3 pt-2">
                  <button 
                    onClick={exportToCSV}
                    className="w-full bg-white border border-gray-200 text-gray-700 p-3.5 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-gray-50 transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
                  >
                    <Download className="w-4 h-4" /> Download Master CSV
                  </button>
                  <button 
                    onClick={handleClearAll}
                    className="w-full border border-red-100 text-red-500 p-3.5 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-red-50 transition-all active:scale-[0.98]"
                  >
                    Clear All Inventory
                  </button>
                </div>
              )}

              {isAdmin && exports.length > 0 && (
                <div className="pt-6 border-t border-gray-100">
                  <div className="flex items-center gap-2 mb-4">
                    <Folder className="w-4 h-4 text-gray-400" />
                    <h3 className="text-[10px] font-bold uppercase text-gray-400 tracking-widest">Recent Server Exports</h3>
                  </div>
                  <div className="space-y-2 max-h-48 overflow-y-auto no-scrollbar">
                    {exports.map((file) => (
                      <div key={file.name} className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg hover:bg-gray-100 transition-all group">
                        <div className="flex items-center gap-2 overflow-hidden">
                          <FileText className="w-3 h-3 text-blue-500 flex-shrink-0" />
                          <span className="text-[10px] text-gray-600 font-medium truncate">{file.name}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <a 
                            href={file.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-all active:scale-90"
                            title="Download from storage"
                          >
                            <Download className="w-3 h-3" />
                          </a>
                          <button
                            onClick={() => handleRemoveExport(file.name)}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-all active:scale-90"
                            title="Delete export"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Right Panel: Inventory Display or Requests */}
        <div className="lg:col-span-8">
          {showRequests ? (
            <section className="bg-white rounded-2xl border border-gray-100 h-full flex flex-col shadow-sm overflow-hidden">
              <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-blue-600 text-white rounded-lg flex items-center justify-center shadow-md">
                    <ClipboardList className="w-4 h-4" />
                  </div>
                  <h2 className="text-sm font-bold text-gray-900 uppercase tracking-tight">Inventory Requests</h2>
                </div>
                <button 
                  onClick={() => setShowRequests(false)}
                  className="text-[10px] font-bold uppercase text-blue-600 hover:text-blue-700 font-sans"
                >
                  Back to Inventory
                </button>
              </div>
              
              <div className="flex-1 overflow-auto no-scrollbar">
                <table className="w-full border-collapse">
                  <thead className="sticky top-0 bg-white/95 backdrop-blur-sm z-10">
                    <tr className="border-b border-gray-100">
                      <th className="text-left p-5 text-[10px] uppercase font-bold text-gray-400 tracking-widest">User</th>
                      <th className="text-left p-5 text-[10px] uppercase font-bold text-gray-400 tracking-widest">Item</th>
                      <th className="text-center p-5 text-[10px] uppercase font-bold text-gray-400 tracking-widest">Type</th>
                      <th className="text-center p-5 text-[10px] uppercase font-bold text-gray-400 tracking-widest">Req Qty</th>
                      <th className="text-center p-5 text-[10px] uppercase font-bold text-gray-400 tracking-widest">Available</th>
                      <th className="text-center p-5 text-[10px] uppercase font-bold text-gray-400 tracking-widest">Status</th>
                      {isAdmin && <th className="text-center p-5 text-[10px] uppercase font-bold text-gray-400 tracking-widest">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {data.requests.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((req) => {
                      const itemInStock = data.items.find(i => i.id === req.itemId);
                      return (
                        <tr key={req.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="p-5">
                            <div className="flex flex-col">
                              <span className="text-xs font-bold text-gray-900">{req.userName}</span>
                              <span className="text-[10px] text-gray-400">{req.userEmail}</span>
                            </div>
                          </td>
                          <td className="p-5">
                            <div className="flex flex-col">
                              <span className="text-xs font-bold text-gray-900">{req.itemName}</span>
                              <span className="text-[10px] text-gray-400 font-mono">{req.itemId}</span>
                            </div>
                          </td>
                          <td className="p-5 text-center">
                            <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${
                              req.type === 'take' ? 'bg-blue-50 text-blue-600' : 'bg-green-50 text-green-600'
                            }`}>
                              {req.type}
                            </span>
                          </td>
                          <td className="p-5 text-center text-xs font-bold text-gray-900">
                            {req.quantity}
                          </td>
                          <td className="p-5 text-center">
                            <span className={`inline-flex items-center justify-center min-w-[32px] h-6 px-2 rounded-full text-[10px] font-bold ${
                              !itemInStock || itemInStock.quantity === 0 ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'
                            }`}>
                              {itemInStock?.quantity ?? 0} In Stock
                            </span>
                          </td>
                          <td className="p-5 text-center">
                          <div className="flex flex-col items-center gap-1">
                            <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase flex items-center gap-1 ${
                              req.status === 'pending' ? 'bg-yellow-50 text-yellow-600' :
                              req.status === 'approved' ? 'bg-green-50 text-green-600' :
                              req.status === 'rejected' ? 'bg-red-50 text-red-600' :
                              'bg-gray-50 text-gray-600'
                            }`}>
                              {req.status === 'pending' && <Clock className="w-3 h-3" />}
                              {req.status === 'approved' && <CheckCircle className="w-3 h-3" />}
                              {req.status === 'rejected' && <XCircle className="w-3 h-3" />}
                              {req.status}
                            </span>
                            {req.note && <span className="text-[9px] text-gray-400 italic max-w-[150px] truncate">&quot;{req.note}&quot;</span>}
                          </div>
                        </td>
                        {isAdmin && (
                          <td className="p-5">
                            {req.status === 'pending' && (
                              <div className="flex items-center justify-center gap-2">
                                <button 
                                  onClick={() => handleApproveRequest(req)}
                                  className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-all active:scale-95"
                                  title="Approve"
                                >
                                  <CheckCircle className="w-4 h-4" />
                                </button>
                                <button 
                                  onClick={() => handleRejectRequest(req)}
                                  className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-all active:scale-95"
                                  title="Reject"
                                >
                                  <XCircle className="w-4 h-4" />
                                </button>
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
                {data.requests.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                      <ClipboardList className="w-8 h-8 text-gray-200" />
                    </div>
                    <p className="text-sm font-bold text-gray-400 uppercase tracking-widest">No requests found</p>
                  </div>
                )}
              </div>
            </section>
          ) : (
            <section className="bg-white rounded-2xl border border-gray-100 h-full flex flex-col shadow-sm overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-white">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center">
                  <Filter className="w-4 h-4" />
                </div>
                <h2 className="text-sm font-bold text-gray-900 uppercase tracking-tight">
                  {selectedCategory === 'Master' ? 'Master Ledger' : `${selectedCategory} Ledger`}
                </h2>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-[10px] font-bold uppercase text-gray-400 tracking-widest">
                  {filteredItems.length} Records Found
                </span>
                {selectedCategory === 'Master' && (
                  <div className="px-2.5 py-1 bg-blue-50 text-blue-600 text-[9px] font-bold uppercase rounded-full tracking-wider">
                    Global View
                  </div>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-auto no-scrollbar">
              <table className="w-full border-collapse">
                <thead className="sticky top-0 bg-white/95 backdrop-blur-sm z-10">
                  <tr className="border-b border-gray-100">
                    <th className="text-left p-5 text-[10px] uppercase font-bold text-gray-400 tracking-widest w-32">ID</th>
                    <th 
                      className="text-left p-5 text-[10px] uppercase font-bold text-gray-400 tracking-widest cursor-pointer hover:text-blue-600 transition-colors"
                      onClick={() => {
                        if (sortBy === 'name') setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                        else { setSortBy('name'); setSortOrder('asc'); }
                      }}
                    >
                      <div className="flex items-center gap-1">
                        Asset Description
                        {sortBy === 'name' && <ArrowUpDown className={`w-3 h-3 ${sortOrder === 'desc' ? 'rotate-180' : ''}`} />}
                      </div>
                    </th>
                    <th 
                      className="text-center p-5 text-[10px] uppercase font-bold text-gray-400 tracking-widest w-24 cursor-pointer hover:text-blue-600 transition-colors"
                      onClick={() => {
                        if (sortBy === 'quantity') setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                        else { setSortBy('quantity'); setSortOrder('asc'); }
                      }}
                    >
                      <div className="flex items-center justify-center gap-1">
                        Qty
                        {sortBy === 'quantity' && <ArrowUpDown className={`w-3 h-3 ${sortOrder === 'desc' ? 'rotate-180' : ''}`} />}
                      </div>
                    </th>
                    <th className="text-center p-5 text-[10px] uppercase font-bold text-gray-400 tracking-widest w-24">Working</th>
                    <th className="text-center p-5 text-[10px] uppercase font-bold text-gray-400 tracking-widest w-24">Loc</th>
                    <th className="text-center p-5 text-[10px] uppercase font-bold text-gray-400 tracking-widest w-48">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {isDataLoading ? (
                    <tr>
                      <td colSpan={6} className="py-20 text-center">
                        <div className="flex flex-col items-center justify-center">
                          <RefreshCcw className="w-8 h-8 text-blue-400 animate-spin mb-4" />
                          <p className="text-sm font-medium text-gray-500 tracking-widest uppercase">Fetching Inventory Records...</p>
                        </div>
                      </td>
                    </tr>
                  ) : sortedItems.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-16 text-center">
                        <div className="flex flex-col items-center justify-center max-w-lg mx-auto bg-gray-50/50 rounded-2xl p-8 border border-gray-100">
                          <div className="w-12 h-12 bg-white shadow-sm text-gray-300 rounded-full flex items-center justify-center mb-4">
                            <Box className="w-6 h-6" />
                          </div>
                          <p className="text-sm font-bold text-gray-900 mb-1">No items found in database</p>
                          <p className="text-xs text-gray-500 mb-6 leading-relaxed">
                            We are currently connected to database: <span className="font-mono text-blue-600 bg-blue-50 px-1 rounded">{activeConfig.databaseId}</span>.
                            If you don&apos;t see your data, your <span className="font-bold">Database ID</span> might be incorrect.
                          </p>
                          
                          <div className="w-full space-y-3 bg-white p-5 rounded-xl border border-gray-100 text-left">
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                              <AlertCircle className="w-3 h-3" /> Troubleshooting Dashboard
                            </p>
                            <div className="space-y-4">
                              <div className="flex gap-3">
                                <div className="w-6 h-6 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center text-[10px] font-black flex-shrink-0">1</div>
                                <div>
                                  <p className="text-[10px] font-bold text-gray-700 uppercase">Check Database ID</p>
                                  <p className="text-[10px] text-gray-500 leading-tight">Your data might be in one of the long IDs seen in your Firebase Console (e.g. ai-studio-8aad...). Update <code className="bg-gray-50 p-0.5 rounded text-blue-600">NEXT_PUBLIC_FIREBASE_FIRESTORE_DATABASE_ID</code> in Vercel.</p>
                                </div>
                              </div>
                              <div className="flex gap-3">
                                <div className="w-6 h-6 rounded-lg bg-green-50 text-green-600 flex items-center justify-center text-[10px] font-black flex-shrink-0">2</div>
                                <div>
                                  <p className="text-[10px] font-bold text-gray-700 uppercase">Authorized Domains</p>
                                  <p className="text-[10px] text-gray-500 leading-tight">Ensure your Vercel URL is added to your Firebase Auth settings &gt; Authorized Domains.</p>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <AnimatePresence mode="popLayout">
                      {sortedItems.map((item) => (
                      <motion.tr 
                        layout
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        key={item.id} 
                        className="group hover:bg-blue-50/30 transition-colors"
                      >
                        <td className="p-5 text-xs font-mono text-gray-400">
                          <span className="bg-gray-100 px-2 py-1 rounded text-gray-600">{item.id}</span>
                        </td>
                        <td className="p-5 text-xs">
                          {editingId === item.id ? (
                            <div className="space-y-3 p-2 bg-gray-50 rounded-xl border border-gray-100">
                              <input 
                                className="w-full border border-gray-200 rounded-lg p-2 bg-white text-xs outline-none focus:border-blue-500 transition-all"
                                placeholder="Item Name"
                                value={editForm?.name || ''}
                                onChange={e => setEditForm(prev => prev ? {...prev, name: e.target.value} : null)}
                              />
                              <div className="grid grid-cols-2 gap-2">
                                <input 
                                  className="border border-gray-200 rounded-lg p-2 bg-white text-[10px] uppercase outline-none focus:border-blue-500 transition-all"
                                  placeholder="Serial #"
                                  value={editForm?.serialNumber || ''}
                                  onChange={e => setEditForm(prev => prev ? {...prev, serialNumber: e.target.value} : null)}
                                />
                                <input 
                                  className="border border-gray-200 rounded-lg p-2 bg-white text-[10px] uppercase outline-none focus:border-blue-500 transition-all"
                                  placeholder="Model #"
                                  value={editForm?.modelNumber || ''}
                                  onChange={e => setEditForm(prev => prev ? {...prev, modelNumber: e.target.value} : null)}
                                />
                                <input 
                                  className="border border-gray-200 rounded-lg p-2 bg-white text-[10px] uppercase outline-none focus:border-blue-500 transition-all"
                                  placeholder="IMEI"
                                  value={editForm?.imei || ''}
                                  onChange={e => setEditForm(prev => prev ? {...prev, imei: e.target.value} : null)}
                                />
                                <input 
                                  className="border border-gray-200 rounded-lg p-2 bg-white text-[10px] uppercase outline-none focus:border-blue-500 transition-all"
                                  placeholder="Adapter"
                                  value={editForm?.adapter || ''}
                                  onChange={e => setEditForm(prev => prev ? {...prev, adapter: e.target.value} : null)}
                                />
                                <input 
                                  className="border border-gray-200 rounded-lg p-2 bg-white text-[10px] uppercase outline-none focus:border-blue-500 transition-all"
                                  placeholder="Cable"
                                  value={editForm?.cable || ''}
                                  onChange={e => setEditForm(prev => prev ? {...prev, cable: e.target.value} : null)}
                                />
                                <input 
                                  className="border border-gray-200 rounded-lg p-2 bg-white text-[10px] uppercase outline-none focus:border-blue-500 transition-all"
                                  placeholder="Sim"
                                  value={editForm?.sim || ''}
                                  onChange={e => setEditForm(prev => prev ? {...prev, sim: e.target.value} : null)}
                                />
                                <input 
                                  className="border border-gray-200 rounded-lg p-2 bg-white text-[10px] uppercase outline-none focus:border-blue-500 transition-all"
                                  placeholder="Box"
                                  value={editForm?.box || ''}
                                  onChange={e => setEditForm(prev => prev ? {...prev, box: e.target.value} : null)}
                                />
                                <select 
                                  className="border border-gray-200 rounded-lg p-2 bg-white text-[10px] outline-none focus:border-blue-500 transition-all"
                                  value={editForm?.working || 'yes'}
                                  onChange={e => setEditForm(prev => prev ? {...prev, working: e.target.value} : null)}
                                >
                                  <option value="yes">Working: Yes</option>
                                  <option value="no">Working: No</option>
                                  <option value="partial">Working: Partial</option>
                                </select>
                                <input 
                                  className="border border-gray-200 rounded-lg p-2 bg-white text-[10px] uppercase outline-none focus:border-blue-500 transition-all"
                                  placeholder="Eles"
                                  value={editForm?.eles || ''}
                                  onChange={e => setEditForm(prev => prev ? {...prev, eles: e.target.value} : null)}
                                />
                              </div>
                              <textarea 
                                className="w-full border border-gray-200 rounded-lg p-2 bg-white text-[10px] outline-none focus:border-blue-500 transition-all min-h-[40px] resize-none"
                                placeholder="Remark"
                                value={editForm?.remark || ''}
                                onChange={e => setEditForm(prev => prev ? {...prev, remark: e.target.value} : null)}
                              />
                              <select 
                                className="w-full border border-gray-200 rounded-lg p-2 bg-white text-[10px] outline-none focus:border-blue-500 transition-all"
                                value={editForm?.category || ''}
                                onChange={e => setEditForm(prev => prev ? {...prev, category: e.target.value} : null)}
                              >
                                {CATEGORIES.filter(c => c !== 'Master').map(c => <option key={c} value={c}>{c}</option>)}
                              </select>
                            </div>
                          ) : (
                            <div className="flex flex-col">
                              <span className="text-sm font-bold text-gray-900 tracking-tight">{item.name}</span>
                              <div className="flex items-center gap-2 mt-1">
                                <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 text-[9px] font-bold uppercase rounded leading-none">{item.category}</span>
                                {item.serialNumber && (
                                  <span className="text-[9px] text-gray-400 flex items-center gap-1">
                                    <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                                    SN: <span className="font-mono">{item.serialNumber}</span>
                                  </span>
                                )}
                                {item.modelNumber && (
                                  <span className="text-[9px] text-gray-400 flex items-center gap-1">
                                    <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                                    MD: <span className="font-mono">{item.modelNumber}</span>
                                  </span>
                                )}
                                {item.imei && (
                                  <span className="text-[9px] text-gray-400 flex items-center gap-1">
                                    <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                                    IMEI: <span className="font-mono">{item.imei}</span>
                                  </span>
                                )}
                              </div>
                              {(item.adapter || item.cable || item.sim || item.box || item.remark) && (
                                <div className="flex flex-wrap gap-2 mt-1.5">
                                  {item.adapter && <span className="text-[8px] text-gray-400 bg-gray-50 px-1 rounded border border-gray-100">ADP: {item.adapter}</span>}
                                  {item.cable && <span className="text-[8px] text-gray-400 bg-gray-50 px-1 rounded border border-gray-100">CBL: {item.cable}</span>}
                                  {item.sim && <span className="text-[8px] text-gray-400 bg-gray-50 px-1 rounded border border-gray-100">SIM: {item.sim}</span>}
                                  {item.box && <span className="text-[8px] text-gray-400 bg-gray-50 px-1 rounded border border-gray-100">BOX: {item.box}</span>}
                                  {item.eles && <span className="text-[8px] text-gray-400 bg-gray-50 px-1 rounded border border-gray-100">ELES: {item.eles}</span>}
                                  {item.remark && <span className="text-[8px] text-gray-500 italic truncate max-w-[200px]" title={item.remark}>&quot;{item.remark}&quot;</span>}
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="p-5 text-center">
                          {editingId === item.id ? (
                            <input 
                              type="number"
                              className="w-16 border border-gray-200 rounded-lg p-2 bg-white text-xs text-center outline-none focus:border-blue-500 transition-all"
                              value={editForm?.quantity || 0}
                              onChange={e => setEditForm(prev => prev ? {...prev, quantity: parseInt(e.target.value) || 0} : null)}
                            />
                          ) : (
                            <span className={`inline-flex items-center justify-center w-10 h-10 rounded-xl font-bold text-xs ${
                              item.quantity < 5 ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'
                            }`}>
                              {item.quantity}
                            </span>
                          )}
                        </td>
                        <td className="p-5 text-center">
                          {editingId === item.id ? (
                            <select 
                              className="w-full border border-gray-200 rounded-lg p-2 bg-white text-[10px] outline-none focus:border-blue-500 transition-all"
                              value={editForm?.working || 'yes'}
                              onChange={e => setEditForm(prev => prev ? {...prev, working: e.target.value} : null)}
                            >
                              <option value="yes">Yes</option>
                              <option value="no">No</option>
                              <option value="partial">Partial</option>
                            </select>
                          ) : (
                            <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${
                              (item.working || 'yes').toLowerCase() === 'yes' ? 'bg-green-50 text-green-600' : 
                              (item.working || 'yes').toLowerCase() === 'no' ? 'bg-red-50 text-red-600' : 
                              'bg-yellow-50 text-yellow-600'
                            }`}>
                              {item.working || 'yes'}
                            </span>
                          )}
                        </td>
                        <td className="p-5 text-center">
                          {editingId === item.id ? (
                            <div className="flex flex-col gap-1">
                              <select 
                                className="w-full border border-gray-200 rounded-lg p-1.5 bg-white text-[10px] outline-none focus:border-blue-500 transition-all"
                                value={editForm?.cupboard || CUPBOARDS[0]}
                                onChange={e => setEditForm(prev => prev ? {...prev, cupboard: e.target.value} : null)}
                              >
                                {CUPBOARDS.map(c => <option key={c} value={c}>{c.length <= 2 ? `C${c}` : c}</option>)}
                              </select>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center">
                              <span className="text-xs font-bold text-gray-900">{item.cupboard.length <= 2 ? `C${item.cupboard}` : item.cupboard}</span>
                            </div>
                          )}
                        </td>
                        <td className="p-5">
                          <div className="flex items-center justify-center gap-2">
                            {editingId === item.id ? (
                              <button 
                                onClick={handleEditSave}
                                className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all shadow-md active:scale-90"
                              >
                                <CheckCircle className="w-4 h-4" />
                              </button>
                            ) : isAdmin ? (
                              <>
                                <button 
                                  onClick={() => handleEditStart(item)}
                                  className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all active:scale-90"
                                >
                                  <Edit3 className="w-4 h-4" />
                                </button>
                                <button 
                                  onClick={() => handleDeleteItem(item.id)}
                                  className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all active:scale-90"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </>
                            ) : (
                              <div className="flex gap-2">
                                <button 
                                  onClick={() => setRequestModal({ item, type: 'take' })}
                                  className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-[10px] font-bold uppercase hover:bg-blue-100 transition-all active:scale-95 flex items-center gap-1"
                                >
                                  <ArrowRightLeft className="w-3 h-3" /> Take
                                </button>
                                <button 
                                  onClick={() => setRequestModal({ item, type: 'return' })}
                                  className="px-3 py-1.5 bg-green-50 text-green-600 rounded-lg text-[10px] font-bold uppercase hover:bg-green-100 transition-all active:scale-95 flex items-center gap-1"
                                >
                                  <RefreshCcw className="w-3 h-3" /> Return
                                </button>
                              </div>
                            )}
                          </div>
                        </td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                )}
                </tbody>
              </table>
            </div>
          </section>
        )}
        </div>
      </main>

      {/* Status Bar */}
      <footer className="bg-white border-t border-gray-100 p-3 px-8 flex items-center justify-between text-[10px] uppercase font-bold tracking-widest text-gray-400">
        <div className="flex items-center gap-8">
          <span className="flex items-center gap-2 text-gray-500">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full shadow-[0_0_8px_rgba(34,197,94,0.5)]"></span>
            {status}
          </span>
          <div className="h-3 w-px bg-gray-100"></div>
          <span className="flex items-center gap-2">
            <RefreshCcw className="w-3 h-3" />
            Project: <span className="text-gray-600">{activeConfig.projectId}</span>
          </span>
          <div className="h-3 w-px bg-gray-100"></div>
          <span className="flex items-center gap-2">
            Database: <span className="text-gray-600">{activeConfig.databaseId}</span>
          </span>
          <div className="h-3 w-px bg-gray-100"></div>
          <span className="flex items-center gap-2">
            Total Units: <span className="text-gray-900">{stats.totalQuantity}</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          Last Action: <span className="text-gray-600">{data.lastAction}</span>
        </div>
      </footer>

      {/* Request Modal */}
      <AnimatePresence>
        {requestModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-md">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white rounded-2xl p-8 w-full max-w-sm shadow-2xl border border-gray-100"
            >
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-6 ${
                requestModal.type === 'take' ? 'bg-blue-50 text-blue-600' : 
                requestModal.type === 'return' ? 'bg-green-50 text-green-600' :
                'bg-purple-50 text-purple-600'
              }`}>
                {requestModal.type === 'take' ? <ArrowRightLeft className="w-6 h-6" /> : 
                 requestModal.type === 'return' ? <RefreshCcw className="w-6 h-6" /> :
                 <Plus className="w-6 h-6" />}
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-1 capitalize">{requestModal.type} Item</h3>
              {requestModal.item ? (
                <div className="mb-6">
                  <p className="text-xs text-gray-900 font-bold">{requestModal.item.name}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${
                      requestModal.item.quantity < 5 ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'
                    }`}>
                      Available: {requestModal.item.quantity}
                    </span>
                    <span className="px-2 py-1 bg-gray-100 text-gray-600 text-[10px] font-bold uppercase rounded">
                      Loc: {requestModal.item.cupboard.length <= 2 ? `C${requestModal.item.cupboard}` : requestModal.item.cupboard}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="mb-6">
                  <label className="block text-[10px] uppercase font-bold text-gray-400 mb-1 tracking-wider">Item Name</label>
                  <input 
                    type="text"
                    className="w-full border border-gray-100 rounded-xl p-3 text-sm font-bold focus:border-blue-500 outline-none bg-gray-50/50"
                    placeholder="What do you need?"
                    value={requestItemName}
                    onChange={e => setRequestItemName(e.target.value)}
                  />
                </div>
              )}
              
              <div className="space-y-4 mb-8">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-gray-400 mb-1 tracking-wider">Quantity</label>
                  <input 
                    type="number"
                    min="1"
                    max={requestModal.type === 'take' ? requestModal.item?.quantity : undefined}
                    className="w-full border border-gray-100 rounded-xl p-3 text-sm font-bold focus:border-blue-500 outline-none bg-gray-50/50"
                    value={requestQuantity}
                    onChange={e => setRequestQuantity(parseInt(e.target.value) || 1)}
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-gray-400 mb-1 tracking-wider">Note (Optional)</label>
                  <textarea 
                    className="w-full border border-gray-100 rounded-xl p-3 text-sm font-bold focus:border-blue-500 outline-none bg-gray-50/50 min-h-[80px] resize-none"
                    placeholder="Why do you need this?"
                    value={requestNote}
                    onChange={e => setRequestNote(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <button 
                  onClick={() => setRequestModal(null)}
                  className="flex-1 px-4 py-3 bg-gray-50 text-gray-600 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-gray-100 transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleRequest}
                  className={`flex-1 px-4 py-3 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-lg active:scale-95 ${
                    requestModal.type === 'take' ? 'bg-blue-600 hover:bg-blue-700 shadow-blue-100' : 
                    requestModal.type === 'return' ? 'bg-green-600 hover:bg-green-700 shadow-green-100' :
                    'bg-purple-600 hover:bg-purple-700 shadow-purple-100'
                  }`}
                >
                  Submit Request
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {confirmModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-md">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white rounded-2xl p-8 w-full max-w-sm shadow-2xl border border-gray-100"
            >
              <div className="w-12 h-12 bg-red-50 text-red-600 rounded-xl flex items-center justify-center mb-6">
                <AlertCircle className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">Confirm Action</h3>
              <p className="text-sm text-gray-500 mb-8 leading-relaxed">{confirmModal.message}</p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setConfirmModal(null)}
                  className="flex-1 px-4 py-3 bg-gray-50 text-gray-600 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-gray-100 transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={confirmModal.onConfirm}
                  className="flex-1 px-4 py-3 bg-red-600 text-white rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-red-700 transition-all shadow-lg shadow-red-100"
                >
                  Confirm
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Import Preview Modal */}
      <AnimatePresence>
        {importPreview && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-md">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white rounded-2xl p-8 w-full max-w-2xl shadow-2xl border border-gray-100 flex flex-col max-h-[80vh]"
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-green-50 text-green-600 rounded-xl flex items-center justify-center">
                    <FileText className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">Import Preview</h3>
                    <p className="text-xs text-gray-500">Review {importPreview.length} items before uploading</p>
                  </div>
                </div>
                <button onClick={() => setImportPreview(null)} className="text-gray-400 hover:text-gray-600">
                  <XCircle className="w-6 h-6" />
                </button>
              </div>

              <div className="flex-1 overflow-auto border border-gray-100 rounded-xl mb-6">
                <table className="w-full text-left text-[10px] border-collapse">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="p-2 font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100">ID</th>
                      <th className="p-2 font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100">Name</th>
                      <th className="p-2 font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100">Qty</th>
                      <th className="p-2 font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100">Model</th>
                      <th className="p-2 font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100">Category</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {importPreview.map((item, i) => (
                      <tr key={i} className="hover:bg-gray-50/50">
                        <td className="p-2 font-mono text-blue-600">{item.id}</td>
                        <td className="p-2 font-medium text-gray-900">{item.name}</td>
                        <td className="p-2 text-gray-600">{item.quantity}</td>
                        <td className="p-2 text-gray-600 truncate max-w-[100px]">{item.modelNumber}</td>
                        <td className="p-2 text-gray-600">{item.category}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex gap-3">
                <button 
                  onClick={() => {
                    if (isImporting) {
                      if (confirm("Import is still in progress. Closing this window will NOT stop the server process but will hide the progress. Are you sure?")) {
                        setImportPreview(null);
                      }
                    } else {
                      setImportPreview(null);
                    }
                  }}
                  className="flex-1 px-4 py-3 bg-gray-50 text-gray-600 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-gray-100 transition-all disabled:opacity-50"
                >
                  {isImporting ? 'Close Process' : 'Cancel'}
                </button>
                <button 
                  onClick={handleConfirmImport}
                  disabled={isImporting}
                  className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isImporting ? (
                    <>
                      <RefreshCcw className="w-4 h-4 animate-spin" />
                      {status.includes('%') ? status.split(': ')[1] : 'Importing...'}
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-4 h-4" />
                      Confirm Import
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style jsx global>{`
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
}
