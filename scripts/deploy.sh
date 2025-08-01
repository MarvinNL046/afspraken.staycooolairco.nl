#!/bin/bash
# Production Deployment Script for StayCool Airco
# This script handles the full deployment process with validation and rollback

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
DEPLOY_ENV="${1:-production}"
NETLIFY_SITE_ID="${NETLIFY_SITE_ID}"
HEALTH_CHECK_URL="https://staycoolairco.nl/api/health"
ROLLBACK_TIMEOUT=300 # 5 minutes

# Logging
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Pre-deployment checks
pre_deploy_checks() {
    log "Running pre-deployment checks..."
    
    # Check Node version
    required_node="22.16.0"
    current_node=$(node -v | cut -d'v' -f2)
    if [ "$current_node" != "$required_node" ]; then
        error "Node version mismatch. Required: $required_node, Current: $current_node"
        exit 1
    fi
    
    # Validate environment variables
    if ! npm run validate:env; then
        error "Environment validation failed"
        exit 1
    fi
    
    # Run tests
    log "Running test suite..."
    if ! npm run test:ci; then
        error "Tests failed. Deployment aborted."
        exit 1
    fi
    
    # Check for uncommitted changes
    if [[ -n $(git status -s) ]]; then
        warning "Uncommitted changes detected"
        read -p "Continue with deployment? (y/N) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
    
    success "Pre-deployment checks passed"
}

# Build application
build_application() {
    log "Building application for $DEPLOY_ENV..."
    
    # Clean previous builds
    rm -rf .next
    rm -rf .netlify
    
    # Generate Prisma client
    npm run prisma:generate
    
    # Build based on environment
    case $DEPLOY_ENV in
        production)
            npm run build:production
            ;;
        staging)
            npm run build:staging
            ;;
        *)
            npm run build:preview
            ;;
    esac
    
    # Verify build output
    if [ ! -d ".next" ]; then
        error "Build failed - .next directory not found"
        exit 1
    fi
    
    # Check bundle size
    if [ -f ".next/analyze/client.html" ]; then
        log "Bundle analysis available at .next/analyze/client.html"
    fi
    
    success "Build completed successfully"
}

# Deploy to Netlify
deploy_to_netlify() {
    log "Deploying to Netlify ($DEPLOY_ENV)..."
    
    # Get current deployment ID for rollback
    PREVIOUS_DEPLOY_ID=$(netlify api getSite --data "{\"site_id\":\"$NETLIFY_SITE_ID\"}" | jq -r '.published_deploy.id')
    log "Previous deployment ID: $PREVIOUS_DEPLOY_ID"
    
    # Deploy based on environment
    case $DEPLOY_ENV in
        production)
            DEPLOY_OUTPUT=$(netlify deploy --prod --json)
            ;;
        staging)
            DEPLOY_OUTPUT=$(netlify deploy --alias staging --json)
            ;;
        *)
            DEPLOY_OUTPUT=$(netlify deploy --json)
            ;;
    esac
    
    # Extract deployment info
    DEPLOY_ID=$(echo "$DEPLOY_OUTPUT" | jq -r '.deploy_id')
    DEPLOY_URL=$(echo "$DEPLOY_OUTPUT" | jq -r '.deploy_url')
    
    log "Deployment ID: $DEPLOY_ID"
    log "Deployment URL: $DEPLOY_URL"
    
    # Store deployment info for rollback
    echo "$PREVIOUS_DEPLOY_ID" > .last_deploy_id
    echo "$DEPLOY_ID" > .current_deploy_id
    
    success "Deployment completed"
}

# Health check
health_check() {
    log "Running health checks..."
    
    # Wait for deployment to be ready
    sleep 10
    
    # Function to check health endpoint
    check_health() {
        local url=$1
        local response=$(curl -s -o /dev/null -w "%{http_code}" "$url" || echo "000")
        echo "$response"
    }
    
    # Check main health endpoint
    HEALTH_STATUS=$(check_health "$HEALTH_CHECK_URL")
    if [ "$HEALTH_STATUS" != "200" ]; then
        error "Health check failed with status: $HEALTH_STATUS"
        return 1
    fi
    
    # Check critical endpoints
    CRITICAL_ENDPOINTS=(
        "/api/appointments/availability"
        "/api/service-areas"
    )
    
    for endpoint in "${CRITICAL_ENDPOINTS[@]}"; do
        status=$(check_health "https://staycoolairco.nl$endpoint")
        if [ "$status" != "200" ] && [ "$status" != "401" ]; then
            error "Critical endpoint check failed: $endpoint (status: $status)"
            return 1
        fi
    done
    
    # Check SSL certificate
    if ! echo | openssl s_client -connect staycoolairco.nl:443 -servername staycoolairco.nl 2>/dev/null | openssl x509 -noout -checkend 86400; then
        warning "SSL certificate expires within 24 hours!"
    fi
    
    success "All health checks passed"
}

# Smoke tests
smoke_tests() {
    log "Running smoke tests..."
    
    # Run Playwright smoke tests
    if ! npx playwright test --grep @smoke --reporter=dot; then
        error "Smoke tests failed"
        return 1
    fi
    
    success "Smoke tests passed"
}

# Rollback deployment
rollback() {
    error "Deployment validation failed. Rolling back..."
    
    if [ -f ".last_deploy_id" ]; then
        ROLLBACK_ID=$(cat .last_deploy_id)
        log "Rolling back to deployment: $ROLLBACK_ID"
        
        # Restore previous deployment
        netlify api restoreSiteDeploy --data "{\"site_id\":\"$NETLIFY_SITE_ID\",\"deploy_id\":\"$ROLLBACK_ID\"}"
        
        # Verify rollback
        sleep 5
        if health_check; then
            success "Rollback completed successfully"
        else
            error "Rollback failed! Manual intervention required."
            exit 1
        fi
    else
        error "No previous deployment ID found for rollback"
        exit 1
    fi
}

# Post-deployment tasks
post_deployment() {
    log "Running post-deployment tasks..."
    
    # Clear CDN cache
    log "Clearing CDN cache..."
    curl -X POST "https://api.netlify.com/api/v1/sites/$NETLIFY_SITE_ID/purge" \
         -H "Authorization: Bearer $NETLIFY_AUTH_TOKEN"
    
    # Warm up cache
    log "Warming up cache..."
    curl -s "$HEALTH_CHECK_URL" > /dev/null
    
    # Update monitoring
    if [ "$DEPLOY_ENV" = "production" ]; then
        # Notify monitoring service
        if [ -n "${DATADOG_API_KEY:-}" ]; then
            curl -X POST "https://api.datadoghq.com/api/v1/events" \
                 -H "DD-API-KEY: $DATADOG_API_KEY" \
                 -H "Content-Type: application/json" \
                 -d "{
                     \"title\": \"Production deployment completed\",
                     \"text\": \"Version $DEPLOY_ID deployed successfully\",
                     \"tags\": [\"deployment\", \"production\"],
                     \"alert_type\": \"info\"
                 }"
        fi
    fi
    
    # Generate deployment report
    cat > deployment-report.json <<EOF
{
    "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
    "environment": "$DEPLOY_ENV",
    "deploy_id": "$DEPLOY_ID",
    "deploy_url": "$DEPLOY_URL",
    "git_commit": "$(git rev-parse HEAD)",
    "git_branch": "$(git rev-parse --abbrev-ref HEAD)",
    "deployed_by": "$(git config user.name)",
    "node_version": "$(node -v)",
    "npm_version": "$(npm -v)"
}
EOF
    
    success "Post-deployment tasks completed"
}

# Main deployment flow
main() {
    log "Starting deployment process for $DEPLOY_ENV environment"
    
    # Trap errors for rollback
    trap 'rollback' ERR
    
    # Execute deployment steps
    pre_deploy_checks
    build_application
    deploy_to_netlify
    
    # Validation with timeout
    if timeout "$ROLLBACK_TIMEOUT" bash -c '
        health_check && smoke_tests
    '; then
        # Remove error trap after successful validation
        trap - ERR
        post_deployment
        
        success "Deployment completed successfully! 🚀"
        log "Deployment URL: $DEPLOY_URL"
        
        # Clean up
        rm -f .last_deploy_id .current_deploy_id
    else
        # Trigger rollback
        false
    fi
}

# Run main function
main "$@"