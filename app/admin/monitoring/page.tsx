'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Activity, 
  AlertCircle, 
  CheckCircle, 
  Clock, 
  Database, 
  HardDrive,
  RefreshCw,
  Server,
  TrendingUp,
  TrendingDown,
  XCircle,
  Zap
} from 'lucide-react';

interface MonitoringData {
  metrics: {
    errors: {
      total: number;
      critical: number;
      rate: number;
    };
    requests: {
      total: number;
      errors: number;
      rate: number;
    };
    performance: {
      avgResponseTime: number;
      avgDbQueryTime: number;
    };
    cache: {
      hits: number;
      misses: number;
      hitRate: number;
    };
  };
  alerts: Array<{
    id: string;
    name: string;
    severity: string;
    message: string;
    triggeredAt: string;
  }>;
  health: {
    status: string;
    checks: Array<{
      name: string;
      status: string;
      latency?: number;
      message?: string;
    }>;
  };
}

interface HealthData {
  status: string;
  checks: {
    database: any;
    cache: any;
    externalServices: any;
    system: any;
  };
  degradation: {
    services: Record<string, string>;
    features: Record<string, boolean>;
    recommendations: string[];
  };
}

export default function MonitoringDashboard() {
  const [monitoringData, setMonitoringData] = useState<MonitoringData | null>(null);
  const [healthData, setHealthData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    fetchData();
    
    if (autoRefresh) {
      const interval = setInterval(fetchData, 30000); // Refresh every 30 seconds
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  const fetchData = async () => {
    try {
      // Fetch monitoring data
      const [monitoringRes, healthRes] = await Promise.all([
        fetch('/.netlify/functions/cache-monitor?action=stats'),
        fetch('/.netlify/functions/health?detailed=true'),
      ]);

      if (!monitoringRes.ok || !healthRes.ok) {
        throw new Error('Failed to fetch monitoring data');
      }

      const monitoring = await monitoringRes.json();
      const health = await healthRes.json();

      // Transform cache monitor data to expected format
      setMonitoringData({
        metrics: {
          errors: monitoring.summary?.errors || { total: 0, critical: 0, rate: 0 },
          requests: monitoring.summary?.requests || { total: 0, errors: 0, rate: 0 },
          performance: monitoring.summary?.performance || { avgResponseTime: 0, avgDbQueryTime: 0 },
          cache: {
            hits: monitoring.summary?.overall?.totalHits || 0,
            misses: monitoring.summary?.overall?.totalMisses || 0,
            hitRate: parseFloat(monitoring.summary?.overall?.hitRate || '0'),
          },
        },
        alerts: [],
        health: {
          status: health.status,
          checks: health.monitoring?.checks || [],
        },
      });
      
      setHealthData(health);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'healthy':
      case 'ok':
        return 'text-green-600';
      case 'degraded':
        return 'text-yellow-600';
      case 'unhealthy':
      case 'critical':
      case 'offline':
        return 'text-red-600';
      default:
        return 'text-gray-600';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status.toLowerCase()) {
      case 'healthy':
      case 'ok':
        return <CheckCircle className="h-4 w-4" />;
      case 'degraded':
        return <AlertCircle className="h-4 w-4" />;
      case 'unhealthy':
      case 'critical':
      case 'offline':
        return <XCircle className="h-4 w-4" />;
      default:
        return <Activity className="h-4 w-4" />;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <RefreshCw className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">System Monitoring</h1>
        <div className="flex gap-4 items-center">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchData}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded"
            />
            Auto-refresh
          </label>
        </div>
      </div>

      {/* System Status Overview */}
      <Card>
        <CardHeader>
          <CardTitle>System Status</CardTitle>
          <CardDescription>Overall health and performance metrics</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="text-center p-4">
              <div className={`text-2xl font-bold ${getStatusColor(healthData?.status || 'unknown')}`}>
                {healthData?.status?.toUpperCase() || 'UNKNOWN'}
              </div>
              <p className="text-sm text-gray-600 mt-1">Overall Status</p>
            </div>
            
            <div className="text-center p-4">
              <div className="text-2xl font-bold">
                {monitoringData?.metrics.requests.rate.toFixed(2) || '0'}/s
              </div>
              <p className="text-sm text-gray-600 mt-1">Request Rate</p>
            </div>
            
            <div className="text-center p-4">
              <div className="text-2xl font-bold">
                {monitoringData?.metrics.performance.avgResponseTime.toFixed(0) || '0'}ms
              </div>
              <p className="text-sm text-gray-600 mt-1">Avg Response Time</p>
            </div>
            
            <div className="text-center p-4">
              <div className="text-2xl font-bold">
                {monitoringData?.metrics.cache.hitRate.toFixed(1) || '0'}%
              </div>
              <p className="text-sm text-gray-600 mt-1">Cache Hit Rate</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="services" className="space-y-4">
        <TabsList>
          <TabsTrigger value="services">Services</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="errors">Errors & Alerts</TabsTrigger>
          <TabsTrigger value="system">System Resources</TabsTrigger>
        </TabsList>

        <TabsContent value="services" className="space-y-4">
          {/* Service Health */}
          <Card>
            <CardHeader>
              <CardTitle>Service Health</CardTitle>
              <CardDescription>Status of internal and external services</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Database */}
                <div className="flex items-center justify-between p-3 border rounded">
                  <div className="flex items-center gap-3">
                    <Database className="h-5 w-5" />
                    <div>
                      <p className="font-medium">Database</p>
                      <p className="text-sm text-gray-600">
                        {healthData?.checks.database.message || 'PostgreSQL via Prisma'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {healthData?.checks.database.latency && (
                      <span className="text-sm text-gray-600">
                        {healthData.checks.database.latency}ms
                      </span>
                    )}
                    <Badge className={getStatusColor(healthData?.checks.database.status || 'unknown')}>
                      {getStatusIcon(healthData?.checks.database.status || 'unknown')}
                      <span className="ml-1">{healthData?.checks.database.status || 'Unknown'}</span>
                    </Badge>
                  </div>
                </div>

                {/* Cache */}
                <div className="flex items-center justify-between p-3 border rounded">
                  <div className="flex items-center gap-3">
                    <HardDrive className="h-5 w-5" />
                    <div>
                      <p className="font-medium">Cache (Redis)</p>
                      <p className="text-sm text-gray-600">
                        Hit Rate: {healthData?.checks.cache.stats?.hitRate || 'N/A'}
                      </p>
                    </div>
                  </div>
                  <Badge className={getStatusColor(healthData?.checks.cache.status || 'unknown')}>
                    {getStatusIcon(healthData?.checks.cache.status || 'unknown')}
                    <span className="ml-1">{healthData?.checks.cache.status || 'Unknown'}</span>
                  </Badge>
                </div>

                {/* External Services */}
                {Object.entries(healthData?.degradation.services || {}).map(([service, status]) => (
                  <div key={service} className="flex items-center justify-between p-3 border rounded">
                    <div className="flex items-center gap-3">
                      <Server className="h-5 w-5" />
                      <div>
                        <p className="font-medium">{service}</p>
                        <p className="text-sm text-gray-600">External Service</p>
                      </div>
                    </div>
                    <Badge className={getStatusColor(status)}>
                      {getStatusIcon(status)}
                      <span className="ml-1">{status}</span>
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Feature Flags */}
          <Card>
            <CardHeader>
              <CardTitle>Feature Status</CardTitle>
              <CardDescription>Enabled features based on service health</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {Object.entries(healthData?.degradation.features || {}).map(([feature, enabled]) => (
                  <div key={feature} className="flex items-center gap-2">
                    {enabled ? (
                      <CheckCircle className="h-4 w-4 text-green-600" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-600" />
                    )}
                    <span className="text-sm">{feature.replace(/([A-Z])/g, ' $1').trim()}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="performance" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Response Times */}
            <Card>
              <CardHeader>
                <CardTitle>Response Times</CardTitle>
                <CardDescription>Average processing times</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex justify-between mb-2">
                    <span className="text-sm">HTTP Requests</span>
                    <span className="text-sm font-medium">
                      {monitoringData?.metrics.performance.avgResponseTime.toFixed(0) || '0'}ms
                    </span>
                  </div>
                  <Progress 
                    value={Math.min((monitoringData?.metrics.performance.avgResponseTime || 0) / 10, 100)} 
                  />
                </div>
                
                <div>
                  <div className="flex justify-between mb-2">
                    <span className="text-sm">Database Queries</span>
                    <span className="text-sm font-medium">
                      {monitoringData?.metrics.performance.avgDbQueryTime.toFixed(0) || '0'}ms
                    </span>
                  </div>
                  <Progress 
                    value={Math.min((monitoringData?.metrics.performance.avgDbQueryTime || 0) / 10, 100)} 
                  />
                </div>
              </CardContent>
            </Card>

            {/* Cache Performance */}
            <Card>
              <CardHeader>
                <CardTitle>Cache Performance</CardTitle>
                <CardDescription>Cache hit/miss statistics</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="text-center">
                    <div className="text-3xl font-bold text-primary">
                      {monitoringData?.metrics.cache.hitRate.toFixed(1) || '0'}%
                    </div>
                    <p className="text-sm text-gray-600 mt-1">Hit Rate</p>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 text-center">
                    <div>
                      <div className="text-xl font-semibold text-green-600">
                        {monitoringData?.metrics.cache.hits.toLocaleString() || '0'}
                      </div>
                      <p className="text-sm text-gray-600">Hits</p>
                    </div>
                    <div>
                      <div className="text-xl font-semibold text-red-600">
                        {monitoringData?.metrics.cache.misses.toLocaleString() || '0'}
                      </div>
                      <p className="text-sm text-gray-600">Misses</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Request Statistics */}
          <Card>
            <CardHeader>
              <CardTitle>Request Statistics</CardTitle>
              <CardDescription>HTTP request metrics</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-2xl font-bold">
                    {monitoringData?.metrics.requests.total.toLocaleString() || '0'}
                  </div>
                  <p className="text-sm text-gray-600 mt-1">Total Requests</p>
                </div>
                <div>
                  <div className="text-2xl font-bold text-red-600">
                    {monitoringData?.metrics.requests.errors.toLocaleString() || '0'}
                  </div>
                  <p className="text-sm text-gray-600 mt-1">Errors</p>
                </div>
                <div>
                  <div className="text-2xl font-bold">
                    {((monitoringData?.metrics.requests.errors || 0) / 
                      (monitoringData?.metrics.requests.total || 1) * 100).toFixed(2)}%
                  </div>
                  <p className="text-sm text-gray-600 mt-1">Error Rate</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="errors" className="space-y-4">
          {/* Error Summary */}
          <Card>
            <CardHeader>
              <CardTitle>Error Summary</CardTitle>
              <CardDescription>Application errors and their severity</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center p-4 border rounded">
                  <div className="text-3xl font-bold">
                    {monitoringData?.metrics.errors.total || 0}
                  </div>
                  <p className="text-sm text-gray-600 mt-1">Total Errors</p>
                </div>
                <div className="text-center p-4 border rounded">
                  <div className="text-3xl font-bold text-red-600">
                    {monitoringData?.metrics.errors.critical || 0}
                  </div>
                  <p className="text-sm text-gray-600 mt-1">Critical Errors</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Active Alerts */}
          <Card>
            <CardHeader>
              <CardTitle>Active Alerts</CardTitle>
              <CardDescription>Current system alerts and warnings</CardDescription>
            </CardHeader>
            <CardContent>
              {monitoringData?.alerts && monitoringData.alerts.length > 0 ? (
                <div className="space-y-3">
                  {monitoringData.alerts.map((alert) => (
                    <Alert key={alert.id} variant={alert.severity === 'critical' ? 'destructive' : 'default'}>
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>{alert.name}</AlertTitle>
                      <AlertDescription>
                        {alert.message}
                        <div className="text-xs text-gray-500 mt-1">
                          Triggered: {new Date(alert.triggeredAt).toLocaleString()}
                        </div>
                      </AlertDescription>
                    </Alert>
                  ))}
                </div>
              ) : (
                <p className="text-gray-600 text-center py-8">No active alerts</p>
              )}
            </CardContent>
          </Card>

          {/* Recommendations */}
          {healthData?.degradation.recommendations && healthData.degradation.recommendations.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Recommendations</CardTitle>
                <CardDescription>Suggested actions to improve system health</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {healthData.degradation.recommendations.map((rec, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <Zap className="h-4 w-4 text-yellow-600 mt-0.5" />
                      <span className="text-sm">{rec}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="system" className="space-y-4">
          {/* System Resources */}
          <Card>
            <CardHeader>
              <CardTitle>System Resources</CardTitle>
              <CardDescription>Server resource utilization</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {/* Memory Usage */}
                <div>
                  <h4 className="font-medium mb-3">Memory Usage</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <p className="text-sm text-gray-600">Heap Used</p>
                      <p className="text-lg font-medium">
                        {healthData?.checks.system.memory.heapUsed || 'N/A'}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Heap Total</p>
                      <p className="text-lg font-medium">
                        {healthData?.checks.system.memory.heapTotal || 'N/A'}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">RSS</p>
                      <p className="text-lg font-medium">
                        {healthData?.checks.system.memory.rss || 'N/A'}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Heap %</p>
                      <p className="text-lg font-medium">
                        {healthData?.checks.system.memory.heapPercentage || 'N/A'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Process Info */}
                <div>
                  <h4 className="font-medium mb-3">Process Information</h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div>
                      <p className="text-sm text-gray-600">Process ID</p>
                      <p className="text-lg font-medium">
                        {healthData?.checks.system.process.pid || 'N/A'}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Node Version</p>
                      <p className="text-lg font-medium">
                        {healthData?.checks.system.process.version || 'N/A'}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Uptime</p>
                      <p className="text-lg font-medium">
                        {healthData?.checks.system.process.uptime 
                          ? `${Math.floor(healthData.checks.system.process.uptime / 3600)}h ${Math.floor((healthData.checks.system.process.uptime % 3600) / 60)}m`
                          : 'N/A'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}