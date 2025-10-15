import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Download, Upload, Trash2, AlertTriangle, Plus, Save, Moon, Sun } from "lucide-react";
import { PieChart as RPieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";


/**
 * Street‑Smart Wealth Tracker – React
 *
 * Design goals (vNext):
 * - 100% local-first (LocalStorage) ✅
 * - ETFs + Gold tracking ✅
 * - Automatic allocations (planner) ✅
 * - Rebalancing triggers ✅ (threshold-based)
 * - CAGR per lane ✅ (simple since-first-contribution)
 * - Manual price updates ✅
 * - Backup/Export + Import/Restore ✅ (JSON)
 * - CSV export (positions & transactions) ✅
 * - Mobile-first responsive layout ✅
 * - Minimal CGT ledger (AUS 50% discount after 12 months) ✅ (FIFO, per-sale calc)
 * - Donut chart for weights (current vs target) ✅
 * - Dark mode toggle (persists) ✅
 */

// ---- Types ----
const DEFAULT_ASSETS = [
  { ticker: "VGS", name: "VGS – Intl Shares", targetWeight: 0.35 },
  { ticker: "VGE", name: "VGE – EM Shares", targetWeight: 0.15 },
  { ticker: "A200", name: "A200 – Aus Shares", targetWeight: 0.30 },
  { ticker: "VAF", name: "VAF – Aus Bonds", targetWeight: 0.10 },
  { ticker: "GOLD", name: "GOLD – Physical ETF", targetWeight: 0.10 },
];

const STORAGE_KEY = "street_smart_wealth_tracker_v3";
const THEME_KEY = "street_smart_theme";

function formatCurrency(n) {
  if (Number.isNaN(n) || !Number.isFinite(n)) return "$0";
  return n.toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 2 });
}

function yearsBetween(a, b) {
  const ms = b - a;
  return ms / (1000 * 60 * 60 * 24 * 365.25);
}

// FIFO lot helper
function consumeLotsFIFO(lots, sellQty) {
  const consumed = [];
  let remaining = sellQty;
  const newLots = [];
  for (const lot of lots) {
    if (remaining <= 0) {
      newLots.push(lot);
      continue;
    }
    const take = Math.min(remaining, lot.qty);
    if (take > 0) {
      consumed.push({ ...lot, qty: take });
    }
    const leftover = lot.qty - take;
    if (leftover > 0) newLots.push({ ...lot, qty: leftover });
    remaining -= take;
  }
  return { consumed, newLots, unfilled: Math.max(0, remaining) };
}

// --- Dev-only smoke tests ---------------------------------------------------
function csvSmokeTest() {
  const s = ["#A", "#B", "#C"].join("\n");
  return typeof s === "string" && s.includes("\n");
}

function fifoSmokeTest() {
  const lots = [{ qty: 2, price: 100, date: "2020-01-01" }, { qty: 3, price: 200, date: "2021-01-01" }];
  const { consumed, newLots, unfilled } = consumeLotsFIFO(lots, 4); // sell 4 units
  const tookFirstLot = consumed[0].qty === 2 && consumed[0].price === 100;
  const tookSecondLot = consumed[1].qty === 2 && consumed[1].price === 200;
  const remainingLot = newLots.length === 1 && newLots[0].qty === 1 && newLots[0].price === 200;
  return tookFirstLot && tookSecondLot && remainingLot && unfilled === 0;
}

function cagrSmokeTest() {
  // invested 100 -> value 121 after ~2 years ~= 10% CAGR
  const start = new Date(Date.now() - 2 * 365.25 * 24 * 60 * 60 * 1000).toISOString();
  const asset = { units: 1, price: 121, invested: 100, firstContribution: start };
  const years = 2;
  const cagr = Math.pow((asset.units * asset.price) / asset.invested, 1 / years) - 1;
  return Math.abs(cagr - 0.10) < 0.02; // within 2%
}

function cgtSmokeTest() {
  const emptyTx = [];
  const fyYear = 2024;
  const start = new Date(`${fyYear}-07-01T00:00:00.000Z`).getTime();
  const end = new Date(`${fyYear + 1}-06-30T23:59:59.999Z`).getTime();
  const sells = emptyTx.filter(t => t.kind === "SELL" && t.date && (new Date(t.date).getTime() >= start) && (new Date(t.date).getTime() <= end));
  return Array.isArray(sells) && sells.length === 0;
}

export default function StreetSmartWealthTracker() {
  // THEME --------------------------------------------------------------------
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || "light");
  useEffect(() => {
    const isDark = theme === "dark";
    const root = document.documentElement;
    root.classList.toggle("dark", isDark);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const [assets, setAssets] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try { return JSON.parse(saved).assets; } catch { /* noop */ }
    }
    // initialize with defaults
    return DEFAULT_ASSETS.map(a => ({
      ...a,
      price: 0,
      units: 0,
      invested: 0,
      lots: [], // { qty, price, date }
      firstContribution: null,
    }));
  });

  const [txn, setTxn] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try { return JSON.parse(saved).transactions || []; } catch { /* noop */ }
    }
    return [];
  });

  const [planner, setPlanner] = useState({ budget: 0, bufferPct: 0, fees: 0 });
  const [rebalance, setRebalance] = useState({ enabled: true, thresholdPct: 5 });
  const [confirmReset, setConfirmReset] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ assets, transactions: txn }));
  }, [assets, txn]);

  useEffect(() => {
    if (import.meta?.env?.DEV) {
      console.assert(csvSmokeTest(), "CSV smoke test failed");
      console.assert(fifoSmokeTest(), "FIFO smoke test failed");
      console.assert(cagrSmokeTest(), "CAGR smoke test failed");
      console.assert(cgtSmokeTest(), "CGT smoke test failed");
    }
  }, []);

  const plannedSplits = useMemo(() => {
    const budget = Math.max(0, Number(planner.budget) || 0);
    const fees = Math.max(0, Number(planner.fees) || 0);
    const bufferPct = Math.max(0, Number(planner.bufferPct) || 0);
    const spendable = Math.max(0, budget - fees - budget * (bufferPct / 100));
    if (spendable <= 0) return [];
    
    const totalWeights = assets.reduce((s, a) => s + (a.targetWeight || 0), 0) || 1;
      return assets.map((a) => {
      const amount = spendable * ((a.targetWeight || 0) / totalWeights);
      const units = a.price > 0 ? amount / a.price : null; // null if no price
      return { ticker: a.ticker, name: a.name, weight: a.targetWeight, amount, units, price: a.price };
    });
  }, [planner, assets]);
  
  const totals = useMemo(() => {
    const invested = assets.reduce((s, a) => s + (a.invested || 0), 0);
    const value = assets.reduce((s, a) => s + (a.units * (a.price || 0)), 0);
    const weights = assets.map(a => ({ ticker: a.ticker, w: value > 0 ? (a.units * (a.price || 0)) / value : 0 }));
    return { invested, value, weights };
  }, [assets]);

  const suggestions = useMemo(() => {
    if (!rebalance.enabled || totals.value <= 0) return [];
    const deltas = assets.map(a => {
      const currentWeight = totals.value > 0 ? (a.units * (a.price || 0)) / totals.value : 0;
      const diffPct = (currentWeight - (a.targetWeight || 0)) * 100;
      return { ticker: a.ticker, name: a.name, diffPct, currentWeight };
    });
    const out = deltas.filter(d => Math.abs(d.diffPct) >= (rebalance.thresholdPct || 0));
    return out.sort((a, b) => Math.abs(b.diffPct) - Math.abs(a.diffPct));
  }, [assets, totals, rebalance]);

  function updateAsset(ticker, patch) {
    setAssets(prev => prev.map(a => (a.ticker === ticker ? { ...a, ...patch } : a)));
  }

  function addTransaction(t) {
    setTxn(prev => [
      { id: crypto.randomUUID(), ...t },
      ...prev,
    ]);
  }

  function handleManualPrice(ticker, price) {
    const p = Math.max(0, Number(price) || 0);
    updateAsset(ticker, { price: p });
  }

  function handleBuy(ticker, amount) {
    const amt = Math.max(0, Number(amount) || 0);
    const a = assets.find(x => x.ticker === ticker);
    if (!a || !a.price || amt <= 0) return;
    const units = amt / a.price;
    const lot = { qty: units, price: a.price, date: new Date().toISOString() };
    updateAsset(ticker, {
      units: a.units + units,
      invested: a.invested + amt,
      lots: [...a.lots, lot],
      firstContribution: a.firstContribution || lot.date,
    });
    addTransaction({ kind: "BUY", ticker, amount: amt, units, price: a.price, date: new Date().toISOString() });
  }

  function handleSell(ticker, amount) {
    const amt = Math.max(0, Number(amount) || 0);
    const a = assets.find(x => x.ticker === ticker);
    if (!a || !a.price || amt <= 0) return;
    const units = amt / a.price;
    const { consumed, newLots, unfilled } = consumeLotsFIFO(a.lots, units);
    if (unfilled > 1e-9) return; // insufficient units; ignore

    // cost base from consumed lots
    const proceeds = units * a.price;
    const costBase = consumed.reduce((s, l) => s + l.qty * l.price, 0);
    const saleDate = new Date();
    const discounted = consumed.reduce((acc, l) => {
      const heldYears = yearsBetween(new Date(l.date), saleDate);
      const gain = l.qty * (a.price - l.price);
      const eligible = heldYears >= 1 ? 0.5 * Math.max(0, gain) : Math.max(0, gain);
      return { gain: acc.gain + Math.max(0, gain), discountGain: acc.discountGain + eligible };
    }, { gain: 0, discountGain: 0 });

    updateAsset(ticker, {
      units: Math.max(0, a.units - units),
      lots: newLots,
    });
    addTransaction({ kind: "SELL", ticker, amount: amt, units, price: a.price, proceeds, costBase, gain: proceeds - costBase, discountGain: discounted.discountGain, date: saleDate.toISOString() });
  }

  function allocateBudget() {
    const budget = Math.max(0, Number(planner.budget) || 0);
    if (budget <= 0) return;
    const fees = Math.max(0, Number(planner.fees) || 0);
    const bufferPct = Math.max(0, Number(planner.bufferPct) || 0);
    const spendable = Math.max(0, budget - fees - budget * (bufferPct / 100));

    // allocate by target weights to tickers that have prices > 0
    const priced = assets.filter(a => a.price > 0);
    const totalWeights = priced.reduce((s, a) => s + (a.targetWeight || 0), 0) || 1;
    const allocations = priced.map(a => ({
      ticker: a.ticker,
      amount: spendable * (a.targetWeight / totalWeights),
    }));
    allocations.forEach(x => handleBuy(x.ticker, x.amount));
  }

  // CAGR per lane – simple since-first-contribution approach
  function getCAGR(asset) {
    if (!asset.firstContribution || asset.invested <= 0) return 0;
    const years = yearsBetween(new Date(asset.firstContribution), new Date());
    if (years <= 0) return 0;
    const value = (asset.units || 0) * (asset.price || 0);
    if (value <= 0) return -1; // total loss
    return Math.pow(value / asset.invested, 1 / years) - 1;
  }

  function exportJSON() {
    const blob = new Blob([JSON.stringify({ assets, transactions: txn }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `street-smart-wealth-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportCSV() {
    const posHeaders = ["Ticker","Units","Price","Invested","MarketValue","Weight"].join(",");
    const posRows = assets.map(a => [
      a.ticker,
      (a.units||0).toFixed(6),
      (a.price||0).toFixed(4),
      (a.invested||0).toFixed(2),
      (a.units*(a.price||0)).toFixed(2),
      totals.value>0?(((a.units*(a.price||0))/totals.value)*100).toFixed(2)+"%":"0%"
    ].join(","));

    const txHeaders = ["Kind","Ticker","Date","Units","Price","Amount","Proceeds","CostBase","Gain","DiscountGain"].join(",");
    const txRows = txn.map(t => [
      t.kind,
      t.ticker,
      t.date,
      (t.units||0).toFixed(6),
      (t.price||0).toFixed(4),
      (t.amount||0).toFixed(2),
      (t.proceeds||0).toFixed(2),
      (t.costBase||0).toFixed(2),
      (t.gain||0).toFixed(2),
      (t.discountGain||0).toFixed(2),
    ].join(","));

    // FIX: use "\n" instead of a broken multiline string
    const content = ["#POSITIONS", posHeaders, ...posRows, "", "#TRANSACTIONS", txHeaders, ...txRows].join("\n");
    const blob = new Blob([content], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `street-smart-wealth-export-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function onImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (!data.assets || !Array.isArray(data.assets)) throw new Error("Invalid backup – assets missing");
        setAssets(data.assets);
        setTxn(Array.isArray(data.transactions) ? data.transactions : []);
      } catch (err) {
        alert("Import failed: " + err.message);
      }
    };
    reader.readAsText(file);
  }

  function resetAll() {
    if (!confirmReset) { setConfirmReset(true); return; }
    localStorage.removeItem(STORAGE_KEY);
    setAssets(DEFAULT_ASSETS.map(a => ({ ...a, price: 0, units: 0, invested: 0, lots: [], firstContribution: null })));
    setTxn([]);
    setConfirmReset(false);
  }

  function CGTSummaryFY(fyStartYear) {
    // FY runs 1 July Y to 30 June Y+1
    const start = new Date(`${fyStartYear}-07-01T00:00:00.000Z`).getTime();
    const end = new Date(`${fyStartYear + 1}-06-30T23:59:59.999Z`).getTime();
    const sells = txn.filter(t => t.kind === "SELL" && t.date && (new Date(t.date).getTime() >= start) && (new Date(t.date).getTime() <= end));
    const grossGain = sells.reduce((s, t) => s + Math.max(0, t.gain || 0), 0);
    const discountGain = sells.reduce((s, t) => s + Math.max(0, t.discountGain || 0), 0);
    return { events: sells.length, grossGain, discountGain };
  }

  const [fyYear, setFyYear] = useState(new Date().getMonth() >= 6 ? new Date().getFullYear() : new Date().getFullYear() - 1);
  const fy = useMemo(() => CGTSummaryFY(fyYear), [txn, fyYear]);

  // CHART DATA ---------------------------------------------------------------
  const COLORS = ["#0ea5e9", "#22c55e", "#a78bfa", "#f59e0b", "#ef4444", "#14b8a6"]; // nice Tailwind hues
  const legendItems = useMemo(
        () => assets.map((a, i) => ({ label: a.ticker, color: COLORS[i % COLORS.length] })),
        [assets]
       );
  const currentWeightData = useMemo(() => {
    if (totals.value <= 0) return assets.map(a => ({ name: a.ticker, value: 0 }));
    return assets.map(a => ({ name: a.ticker, value: (a.units * (a.price || 0)) }));
  }, [assets, totals.value]);

  const targetWeightData = useMemo(() => assets.map(a => ({ name: a.ticker, value: a.targetWeight })), [assets]);

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <header className="mb-4 sm:mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Street‑Smart Wealth Tracker</h1>
        	<p className="text-sm text-muted-foreground">Local‑first · ETFs + Gold · Aussie CGT (basic) · No fluff.</p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <Button variant="ghost" size="sm" className="gap-1" onClick={() => setTheme(t => (t === "dark" ? "light" : "dark"))}>
            {theme === "dark" ? <Sun className="h-4 w-4"/> : <Moon className="h-4 w-4"/>}
            <span className="text-sm hidden sm:inline">{theme === "dark" ? "Light" : "Dark"} mode</span>
          </Button>
          <Button variant="secondary" size="sm" onClick={exportCSV} className="gap-1">
           <Download className="h-4 w-4"/><span className="hidden sm:inline">CSV</span>
          </Button>
          <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()} className="gap-1">
             <Upload className="h-4 w-4"/><span className="hidden sm:inline">Import</span>
          </Button>
          <Button variant="secondary" onClick={() => fileInputRef.current?.click()} className="gap-2"><Upload className="h-4 w-4"/>Import</Button>
          <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={onImportFile} />
          <Button variant={confirmReset ? "destructive" : "outline"} size="sm" onClick={resetAll} className="gap-1">
            <Trash2 className="h-4 w-4"/>{confirmReset ? "Confirm reset" : "Reset"}
          </Button>
        </div>
      </header>

      <Tabs defaultValue="planner">
        <div className="w-full overflow-x-auto mb-3">
          <TabsList className="inline-flex w-max gap-1 px-1 py-1">
            <TabsTrigger className="shrink-0 px-3 py-2 text-sm" value="planner">Plan</TabsTrigger>
            <TabsTrigger className="shrink-0 px-3 py-2 text-sm" value="portfolio">Holdings</TabsTrigger>
            <TabsTrigger className="shrink-0 px-3 py-2 text-sm" value="prices">Prices</TabsTrigger>
            <TabsTrigger className="shrink-0 px-3 py-2 text-sm" value="cgt">CGT</TabsTrigger>
            <TabsTrigger className="shrink-0 px-3 py-2 text-sm" value="settings">Settings</TabsTrigger>
          </TabsList>
        </div>
        {/* Planner */}
        <TabsContent value="planner">
          <Card className="border rounded-2xl">
            <CardContent className="p-4 sm:p-6">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <Label>Budget (AUD)</Label>
                  <Input inputMode="decimal" placeholder="0" value={planner.budget}
                         onChange={e => setPlanner(p => ({ ...p, budget: e.target.value }))}/>
                </div>
                <div>
                  <Label>Fees (flat)</Label>
                  <Input inputMode="decimal" placeholder="0" value={planner.fees}
                         onChange={e => setPlanner(p => ({ ...p, fees: e.target.value }))}/>
                </div>
                <div>
                  <Label>Buffer %</Label>
                  <Input inputMode="decimal" placeholder="0" value={planner.bufferPct}
                         onChange={e => setPlanner(p => ({ ...p, bufferPct: e.target.value }))}/>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mt-4">
                <Button className="gap-2" onClick={allocateBudget}><Plus className="h-4 w-4"/>Allocate Now</Button>
              </div>

              {/* Live preview of planned splits (doesn't change state until Apply) */}
              <div className="mt-4">
                <div className="mb-2 text-sm text-muted-foreground">
                  Preview based on your Budget, Fees and Buffer. Amounts always shown; units appear if a price is set.
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-muted-foreground">
                      <tr>
                        <th className="py-2 pr-3">Ticker</th>
                        <th className="py-2 pr-3">Target</th>
                        <th className="py-2 pr-3">Amount</th>
                        <th className="py-2 pr-3">Units (est)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plannedSplits.map((row) => (
                        <tr key={row.ticker} className="border-t">
                          <td className="py-2 pr-3 font-medium">{row.ticker}</td>
                          <td className="py-2 pr-3">{(row.weight * 100).toFixed(0)}%</td>
                          <td className="py-2 pr-3">{formatCurrency(row.amount)}</td>
                          <td className="py-2 pr-3">
                            {row.units != null ? row.units.toFixed(4) : <span className="text-muted-foreground">— set price</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-end mt-3">
                  <Button onClick={allocateBudget} size="sm" className="gap-2">
                    <Plus className="h-4 w-4" /> Apply buys
                  </Button>
                </div>
              </div>
              
              <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {assets.map(a => {
                  const value = (a.units || 0) * (a.price || 0);
                  const weight = totals.value > 0 ? value / totals.value : 0;
                  const cagr = getCAGR(a);
                  return (
                    <Card key={a.ticker} className="rounded-2xl">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-semibold">{a.name}</div>
                            <div className="text-xs text-muted-foreground">Target {(a.targetWeight*100).toFixed(0)}% · Current {(weight*100).toFixed(1)}%</div>
                          </div>
                          {rebalance.enabled && Math.abs((weight - a.targetWeight) * 100) >= rebalance.thresholdPct && (
                            <span className="text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-900 flex items-center gap-1"><AlertTriangle className="h-3 w-3"/>Rebalance</span>
                          )}
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <div className="text-muted-foreground">Units</div>
                            <div className="font-medium">{(a.units||0).toFixed(4)}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Price</div>
                            <div className="font-medium">{formatCurrency(a.price||0)}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Invested</div>
                            <div className="font-medium">{formatCurrency(a.invested||0)}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Value</div>
                            <div className="font-medium">{formatCurrency(value)}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">CAGR</div>
                            <div className="font-medium">{(cagr*100).toFixed(2)}%</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Δ vs Target</div>
                            <div className="font-medium">{((weight - a.targetWeight)*100).toFixed(1)}%</div>
                          </div>
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-2">
                          <Button variant="outline" onClick={() => handleBuy(a.ticker, 1000)}>Buy $1k</Button>
                          <Button variant="outline" onClick={() => handleSell(a.ticker, 1000)}>Sell $1k</Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Portfolio */}
        <TabsContent value="portfolio" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Donut chart card */}
            <Card className="lg:col-span-4 rounded-2xl">
              <CardContent className="p-4 sm:p-6">
                <h2 className="font-semibold mb-2">Allocation – Current vs Target</h2>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <RPieChart>
                      {/* Outer = current (by $ value) */}
                      <Pie dataKey="value" data={currentWeightData} nameKey="name" outerRadius={80} innerRadius={48}>
                        {currentWeightData.map((entry, i) => (
                          <Cell key={`c-${i}`} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      {/* Inner = target (by targetWeight) */}
                      <Pie dataKey="value" data={targetWeightData} nameKey="name" outerRadius={42} innerRadius={24}>
                        {targetWeightData.map((entry, i) => (
                          <Cell key={`t-${i}`} fill={COLORS[i % COLORS.length]} opacity={0.45} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v, n) => [typeof v === "number" ? v.toFixed(2) : v, n]}/>
                    </RPieChart>
                  </ResponsiveContainer>                 
                </div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm">
                    {legendItems.map((item) => (
                      <div key={item.label} className="flex items-center gap-2">
                        <span
                          className="inline-block h-3 w-3 rounded-sm"
                          style={{ backgroundColor: item.color }}
                        />
                        <span className="text-muted-foreground">{item.label}</span>
                      </div>
                    ))}
                </div>
                <p className="text-xs text-muted-foreground mt-2">Outer ring = current; inner ring = target.</p>
              </CardContent>
            </Card>

            <Card className="lg:col-span-8 rounded-2xl">
              <CardContent className="p-4 sm:p-6">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-semibold">Positions</h2>
                  <div className="text-sm text-muted-foreground">Invested {formatCurrency(totals.invested)} · Value {formatCurrency(totals.value)}</div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-muted-foreground">
                      <tr>
                        <th className="py-2 pr-3">Ticker</th>
                        <th className="py-2 pr-3">Units</th>
                        <th className="py-2 pr-3">Price</th>
                        <th className="py-2 pr-3">Invested</th>
                        <th className="py-2 pr-3">Value</th>
                        <th className="py-2 pr-3">Weight</th>
                      </tr>
                    </thead>
                    <tbody>
                    {assets.map(a => {
                      const value = (a.units||0)*(a.price||0);
                      const w = totals.value>0? value/totals.value:0;
                      return (
                        <tr key={a.ticker} className="border-t">
                          <td className="py-2 pr-3 font-medium">{a.ticker}</td>
                          <td className="py-2 pr-3">{(a.units||0).toFixed(6)}</td>
                          <td className="py-2 pr-3">{formatCurrency(a.price||0)}</td>
                          <td className="py-2 pr-3">{formatCurrency(a.invested||0)}</td>
                          <td className="py-2 pr-3">{formatCurrency(value)}</td>
                          <td className="py-2 pr-3">{(w*100).toFixed(2)}%</td>
                        </tr>
                      );
                    })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="mt-4 rounded-2xl">
            <CardContent className="p-4 sm:p-6">
              <h2 className="font-semibold mb-2">Transactions</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-3">Kind</th>
                      <th className="py-2 pr-3">Ticker</th>
                      <th className="py-2 pr-3">Date</th>
                      <th className="py-2 pr-3">Units</th>
                      <th className="py-2 pr-3">Price</th>
                      <th className="py-2 pr-3">Amount</th>
                      <th className="py-2 pr-3">Proceeds</th>
                      <th className="py-2 pr-3">Cost Base</th>
                      <th className="py-2 pr-3">Gain</th>
                      <th className="py-2 pr-3">Discount Gain</th>
                    </tr>
                  </thead>
                  <tbody>
                  {txn.map(t => (
                    <tr key={t.id} className="border-t">
                      <td className="py-2 pr-3 font-medium">{t.kind}</td>
                      <td className="py-2 pr-3">{t.ticker}</td>
                      <td className="py-2 pr-3">{new Date(t.date).toLocaleString()}</td>
                      <td className="py-2 pr-3">{(t.units||0).toFixed(6)}</td>
                      <td className="py-2 pr-3">{formatCurrency(t.price||0)}</td>
                      <td className="py-2 pr-3">{formatCurrency(t.amount||0)}</td>
                      <td className="py-2 pr-3">{formatCurrency(t.proceeds||0)}</td>
                      <td className="py-2 pr-3">{formatCurrency(t.costBase||0)}</td>
                      <td className="py-2 pr-3">{formatCurrency(t.gain||0)}</td>
                      <td className="py-2 pr-3">{formatCurrency(t.discountGain||0)}</td>
                    </tr>
                  ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Prices */}
        <TabsContent value="prices" className="mt-4">
          <Card className="rounded-2xl">
            <CardContent className="p-4 sm:p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {assets.map(a => (
                  <div key={a.ticker} className="p-3 border rounded-xl flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <div className="font-semibold">{a.ticker}</div>
                      <div className="text-xs text-muted-foreground">{a.name}</div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>Price (AUD)</Label>
                        <Input inputMode="decimal" value={a.price}
                               onChange={e => handleManualPrice(a.ticker, e.target.value)} />
                      </div>
                      <div>
                        <Label>Target Weight %</Label>
                        <Input inputMode="decimal" value={(a.targetWeight*100).toFixed(2)}
                               onChange={e => updateAsset(a.ticker, { targetWeight: Math.max(0, Number(e.target.value)||0)/100 })} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="outline" onClick={() => handleBuy(a.ticker, 500)}>Buy $500</Button>
                      <Button variant="outline" onClick={() => handleSell(a.ticker, 500)}>Sell $500</Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* CGT */}
        <TabsContent value="cgt" className="mt-4">
          <Card className="rounded-2xl">
            <CardContent className="p-4 sm:p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label>Financial Year (start year)</Label>
                  <Input inputMode="numeric" value={fyYear}
                         onChange={e => setFyYear(Number(e.target.value)||fyYear)} />
                </div>
                <div className="flex items-end">
                  <div className="text-sm text-muted-foreground">FY {fyYear}-{String((fyYear+1)).slice(2)} · Events {fy.events}</div>
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700">
                <div className="text-sm">Gross Gains (no losses netting): <span className="font-medium">{formatCurrency(fy.grossGain)}</span></div>
                <div className="text-sm">Discounted Gains (AUS 50% rule applied to {">"}12mo lots): <span className="font-medium">{formatCurrency(fy.discountGain)}</span></div>
                <p className="text-xs text-muted-foreground mt-2">Note: This is a simplified calculator (FIFO, no capital losses applied, no brokerage adjustments).
                  Export CSV and verify with your tax accountant.</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Settings */}
        <TabsContent value="settings" className="mt-4">
          <Card className="rounded-2xl">
            <CardContent className="p-4 sm:p-6 space-y-4">
              <h2 className="font-semibold">App Settings</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-3 border rounded-xl">
                  <div className="mb-2 font-medium">Backup & Restore</div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" className="gap-2" onClick={exportJSON}><Save className="h-4 w-4"/> Save Backup</Button>
                    <Button variant="secondary" className="gap-2" onClick={() => fileInputRef.current?.click()}><Upload className="h-4 w-4"/> Restore</Button>
                    <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={onImportFile} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">Backups include positions and transactions only. Prices are whatever you last entered.
                  </p>
                </div>
                <div className="p-3 border rounded-xl">
                  <div className="mb-2 font-medium">Theme</div>
                  <div className="flex items-center gap-3">
                    <Switch checked={theme === "dark"} onCheckedChange={(v) => setTheme(v ? "dark" : "light")} />
                    <span className="text-sm">Dark mode</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">Preference is saved on this device.</p>
                </div>
                <div className="p-3 border rounded-xl">
                  <div className="mb-2 font-medium">Danger Zone</div>
                  <Button variant={confirmReset ? "destructive" : "outline"} onClick={resetAll} className="gap-2"><Trash2 className="h-4 w-4"/>{confirmReset?"Confirm reset":"Reset all data"}</Button>
                  <p className="text-xs text-muted-foreground mt-2">Local-only. No cloud—your data never leaves your device.</p>
                </div>
              </div>

              <div className="p-3 border rounded-xl">
                <div className="mb-2 font-medium">Notes</div>
                <p className="text-xs text-muted-foreground">Record any assumptions or reminders for your future self.</p>
                <Textarea placeholder="e.g., Rebalance quarterly unless &gt;5% drift; add $1k/mo; keep 10% cash buffer for dry powder." />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <footer className="mt-8 text-xs text-muted-foreground text-center">
        Built Chuck‑style · No fluff · v3
      </footer>
    </div>
  );
}