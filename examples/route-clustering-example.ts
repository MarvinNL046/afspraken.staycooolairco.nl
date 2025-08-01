/**
 * Route Clustering System - Example Implementation
 * 
 * This example demonstrates how to use the intelligent route clustering system
 * to organize appointments into efficient daily routes.
 */

import axios from 'axios';
import { format, addDays, startOfWeek } from 'date-fns';

// Configuration
const API_BASE_URL = process.env.NETLIFY_URL || 'http://localhost:8888';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'your-admin-api-key';

// Types
interface ClusterRoutesRequest {
  startDate: string;
  endDate?: string;
  centerPoint?: {
    lat: number;
    lng: number;
  };
  travelMode?: 'DRIVING' | 'BICYCLING' | 'WALKING' | 'TRANSIT';
  optimizationStrategy?: 'balanced' | 'minimal_travel' | 'maximum_appointments';
  apiKey: string;
}

interface RouteAnalysisRequest {
  routeClusterId?: string;
  date?: string;
  travelMode?: 'DRIVING' | 'BICYCLING' | 'WALKING' | 'TRANSIT';
  includeRecommendations?: boolean;
  apiKey: string;
}

/**
 * Example 1: Basic Route Clustering for Next Week
 */
async function clusterRoutesForNextWeek() {
  console.log('🚀 Clustering routes for next week...\n');

  const nextMonday = startOfWeek(addDays(new Date(), 7), { weekStartsOn: 1 });
  const nextFriday = addDays(nextMonday, 4);

  const request: ClusterRoutesRequest = {
    startDate: format(nextMonday, 'yyyy-MM-dd'),
    endDate: format(nextFriday, 'yyyy-MM-dd'),
    travelMode: 'DRIVING',
    optimizationStrategy: 'balanced',
    apiKey: ADMIN_API_KEY,
  };

  try {
    const response = await axios.post(
      `${API_BASE_URL}/.netlify/functions/cluster-routes`,
      request
    );

    const { result } = response.data;
    
    console.log('📊 Clustering Summary:');
    console.log(`- Total appointments: ${result.summary.totalAppointments}`);
    console.log(`- Assigned appointments: ${result.summary.assignedAppointments}`);
    console.log(`- Unassigned appointments: ${result.unassignedAppointments.length}`);
    console.log(`- Average efficiency: ${result.summary.averageEfficiency}%`);
    console.log(`- Total travel distance: ${(result.summary.totalTravelDistance / 1000).toFixed(1)}km`);
    console.log(`- Total travel time: ${Math.round(result.summary.totalTravelTime / 60)} hours\n`);

    // Display daily routes
    console.log('📅 Daily Routes:');
    result.clusters.forEach((cluster: any) => {
      console.log(`\n${format(new Date(cluster.date), 'EEEE, dd MMMM')}:`);
      console.log(`  - Appointments: ${cluster.appointments.length}`);
      console.log(`  - Efficiency: ${cluster.efficiency}%`);
      console.log(`  - Travel time: ${cluster.totalTravelTime} minutes`);
      console.log(`  - Distance: ${(cluster.totalDistance / 1000).toFixed(1)}km`);
      
      // Show timeline
      console.log('  - Timeline:');
      cluster.timeline.slice(0, 5).forEach((slot: any) => {
        if (slot.type === 'appointment') {
          console.log(`    ${slot.startTime} - ${slot.endTime}: Appointment`);
        } else if (slot.type === 'travel') {
          console.log(`    ${slot.startTime} - ${slot.endTime}: Travel (${slot.travelDuration} min)`);
        }
      });
      if (cluster.timeline.length > 5) {
        console.log(`    ... and ${cluster.timeline.length - 5} more activities`);
      }
    });

    return result;
  } catch (error) {
    console.error('❌ Error clustering routes:', error);
    throw error;
  }
}

/**
 * Example 2: Analyze Route Efficiency with Recommendations
 */
async function analyzeRouteEfficiency(date: string) {
  console.log(`\n🔍 Analyzing route efficiency for ${date}...\n`);

  const request: RouteAnalysisRequest = {
    date,
    travelMode: 'DRIVING',
    includeRecommendations: true,
    apiKey: ADMIN_API_KEY,
  };

  try {
    const response = await axios.post(
      `${API_BASE_URL}/.netlify/functions/analyze-route-efficiency`,
      request
    );

    const { analyses } = response.data;
    
    analyses.forEach((analysis: any) => {
      console.log(`📊 Route Analysis for ${analysis.date}:`);
      console.log(`- Appointments: ${analysis.metrics.appointments}`);
      console.log(`- Total distance: ${(analysis.metrics.totalDistance / 1000).toFixed(1)}km`);
      console.log(`- Working time: ${analysis.metrics.workingTime} minutes`);
      console.log(`- Efficiency: ${analysis.metrics.efficiency}%`);
      console.log(`- Utilization: ${analysis.metrics.utilizationRate}%`);
      
      console.log(`\n💰 Costs:`);
      console.log(`- Fuel: €${analysis.costs.fuel}`);
      console.log(`- Time: €${analysis.costs.time}`);
      console.log(`- Total: €${analysis.costs.total}`);
      
      if (analysis.recommendations && analysis.recommendations.length > 0) {
        console.log(`\n💡 Recommendations:`);
        analysis.recommendations.forEach((rec: string) => {
          console.log(`- ${rec}`);
        });
      }
      
      if (analysis.alternativeRoutes && analysis.alternativeRoutes.length > 0) {
        console.log(`\n🔄 Alternative Routes:`);
        analysis.alternativeRoutes.forEach((alt: any) => {
          console.log(`- ${alt.strategy}: ${alt.savingsPercentage}% potential savings`);
          console.log(`  ${alt.improvement}`);
        });
      }
    });

    return analyses;
  } catch (error) {
    console.error('❌ Error analyzing route:', error);
    throw error;
  }
}

/**
 * Example 3: Cluster Routes with Custom Center Point
 */
async function clusterRoutesFromWarehouse() {
  console.log('\n🏭 Clustering routes from warehouse location...\n');

  const warehouseLocation = {
    lat: 52.3105,  // Amsterdam Zuid
    lng: 4.8684
  };

  const request: ClusterRoutesRequest = {
    startDate: format(new Date(), 'yyyy-MM-dd'),
    centerPoint: warehouseLocation,
    travelMode: 'DRIVING',
    optimizationStrategy: 'minimal_travel',
    apiKey: ADMIN_API_KEY,
  };

  try {
    const response = await axios.post(
      `${API_BASE_URL}/.netlify/functions/cluster-routes`,
      request
    );

    const { result } = response.data;
    console.log(`✅ Clustered ${result.summary.assignedAppointments} appointments from warehouse location`);
    console.log(`📍 Center point: ${warehouseLocation.lat}, ${warehouseLocation.lng}`);
    
    return result;
  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  }
}

/**
 * Example 4: Handle Unassigned Appointments
 */
async function handleUnassignedAppointments() {
  console.log('\n🔧 Handling unassigned appointments...\n');

  // First, cluster routes normally
  const nextMonday = startOfWeek(addDays(new Date(), 7), { weekStartsOn: 1 });
  
  const request: ClusterRoutesRequest = {
    startDate: format(nextMonday, 'yyyy-MM-dd'),
    travelMode: 'DRIVING',
    optimizationStrategy: 'maximum_appointments',
    apiKey: ADMIN_API_KEY,
  };

  try {
    const response = await axios.post(
      `${API_BASE_URL}/.netlify/functions/cluster-routes`,
      request
    );

    const { result } = response.data;
    
    if (result.unassignedAppointments.length > 0) {
      console.log(`⚠️  Found ${result.unassignedAppointments.length} unassigned appointments:`);
      
      result.unassignedAppointments.forEach((apt: any) => {
        console.log(`\n- Appointment ${apt.id}`);
        console.log(`  Date: ${format(new Date(apt.datum), 'dd-MM-yyyy')}`);
        console.log(`  Time: ${apt.tijd}`);
        console.log(`  Address: ${apt.address}`);
        console.log(`  Priority: ${apt.priority}`);
      });
      
      console.log('\n📋 Suggested actions:');
      console.log('1. Consider extending working hours for high-priority appointments');
      console.log('2. Check if appointments can be rescheduled to less busy days');
      console.log('3. Verify addresses are within the 20km radius constraint');
      console.log('4. Consider using bicycle for nearby appointments to save time');
    } else {
      console.log('✅ All appointments successfully assigned!');
    }
    
    return result.unassignedAppointments;
  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  }
}

/**
 * Example 5: Compare Different Optimization Strategies
 */
async function compareOptimizationStrategies() {
  console.log('\n📊 Comparing optimization strategies...\n');

  const strategies: Array<'balanced' | 'minimal_travel' | 'maximum_appointments'> = [
    'balanced',
    'minimal_travel',
    'maximum_appointments'
  ];
  
  const results: any[] = [];
  const testDate = format(new Date(), 'yyyy-MM-dd');

  for (const strategy of strategies) {
    const request: ClusterRoutesRequest = {
      startDate: testDate,
      travelMode: 'DRIVING',
      optimizationStrategy: strategy,
      apiKey: ADMIN_API_KEY,
    };

    try {
      const response = await axios.post(
        `${API_BASE_URL}/.netlify/functions/cluster-routes`,
        request
      );

      results.push({
        strategy,
        summary: response.data.result.summary
      });
    } catch (error) {
      console.error(`Error with ${strategy} strategy:`, error);
    }
  }

  // Compare results
  console.log('📈 Strategy Comparison:\n');
  results.forEach(({ strategy, summary }) => {
    console.log(`${strategy.toUpperCase()} Strategy:`);
    console.log(`- Assigned: ${summary.assignedAppointments}/${summary.totalAppointments}`);
    console.log(`- Efficiency: ${summary.averageEfficiency}%`);
    console.log(`- Travel distance: ${(summary.totalTravelDistance / 1000).toFixed(1)}km`);
    console.log(`- Travel time: ${summary.totalTravelTime} minutes\n`);
  });

  // Recommend best strategy
  const best = results.reduce((prev, current) => 
    current.summary.averageEfficiency > prev.summary.averageEfficiency ? current : prev
  );
  
  console.log(`🏆 Recommended strategy: ${best.strategy.toUpperCase()}`);
  console.log(`   Achieves ${best.summary.averageEfficiency}% efficiency`);

  return results;
}

/**
 * Example 6: Monitor Weekly Performance
 */
async function monitorWeeklyPerformance() {
  console.log('\n📊 Weekly Performance Monitoring...\n');

  const monday = startOfWeek(new Date(), { weekStartsOn: 1 });
  const dates: string[] = [];
  
  // Get all weekdays
  for (let i = 0; i < 5; i++) {
    dates.push(format(addDays(monday, i), 'yyyy-MM-dd'));
  }

  const weeklyMetrics = {
    totalAppointments: 0,
    totalDistance: 0,
    totalCost: 0,
    totalEfficiency: 0,
    days: 0
  };

  for (const date of dates) {
    try {
      const response = await axios.post(
        `${API_BASE_URL}/.netlify/functions/analyze-route-efficiency`,
        {
          date,
          travelMode: 'DRIVING',
          includeRecommendations: false,
          apiKey: ADMIN_API_KEY,
        }
      );

      const { analyses } = response.data;
      
      if (analyses.length > 0) {
        const dayAnalysis = analyses[0];
        weeklyMetrics.totalAppointments += dayAnalysis.metrics.appointments;
        weeklyMetrics.totalDistance += dayAnalysis.metrics.totalDistance;
        weeklyMetrics.totalCost += dayAnalysis.costs.total;
        weeklyMetrics.totalEfficiency += dayAnalysis.metrics.efficiency;
        weeklyMetrics.days++;
        
        console.log(`${format(new Date(date), 'EEEE')}: ${dayAnalysis.metrics.appointments} appointments, ${dayAnalysis.metrics.efficiency}% efficiency`);
      }
    } catch (error) {
      console.log(`${format(new Date(date), 'EEEE')}: No data`);
    }
  }

  console.log('\n📊 Weekly Summary:');
  console.log(`- Total appointments: ${weeklyMetrics.totalAppointments}`);
  console.log(`- Total distance: ${(weeklyMetrics.totalDistance / 1000).toFixed(1)}km`);
  console.log(`- Total cost: €${weeklyMetrics.totalCost.toFixed(2)}`);
  console.log(`- Average efficiency: ${Math.round(weeklyMetrics.totalEfficiency / weeklyMetrics.days)}%`);
  console.log(`- Cost per appointment: €${(weeklyMetrics.totalCost / weeklyMetrics.totalAppointments).toFixed(2)}`);

  return weeklyMetrics;
}

// Main execution
async function main() {
  console.log('🚀 Route Clustering System Examples\n');
  console.log('==================================\n');

  try {
    // Example 1: Basic clustering
    await clusterRoutesForNextWeek();
    
    // Example 2: Analyze efficiency
    await analyzeRouteEfficiency(format(new Date(), 'yyyy-MM-dd'));
    
    // Example 3: Custom center point
    await clusterRoutesFromWarehouse();
    
    // Example 4: Handle unassigned
    await handleUnassignedAppointments();
    
    // Example 5: Compare strategies
    await compareOptimizationStrategies();
    
    // Example 6: Weekly monitoring
    await monitorWeeklyPerformance();
    
  } catch (error) {
    console.error('\n❌ Example execution failed:', error);
  }
}

// Run examples if executed directly
if (require.main === module) {
  main();
}

// Export functions for use in other modules
export {
  clusterRoutesForNextWeek,
  analyzeRouteEfficiency,
  clusterRoutesFromWarehouse,
  handleUnassignedAppointments,
  compareOptimizationStrategies,
  monitorWeeklyPerformance
};