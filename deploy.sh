#!/bin/bash
# ============================================================
#  ÉCOLE PRO — Script de déploiement & gestion
#  Usage : ./deploy.sh [commande]
# ============================================================

set -e
COMPOSE="docker compose"
PROJECT="ecolepro"

# ── Couleurs ─────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()    { echo -e "${GREEN}[INFO]${NC} $1"; }
warning() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()   { echo -e "${RED}[ERR ]${NC} $1"; exit 1; }

# ── Vérifications préalables ─────────────────────────────
check_requirements() {
    command -v docker  >/dev/null || error "Docker non installé"
    command -v openssl >/dev/null || error "OpenSSL non installé"
    [ -f .env ] || error "Fichier .env manquant. Copier .env.example et remplir les valeurs."
    info "Prérequis OK"
}

# ── Premier déploiement ───────────────────────────────────
setup() {
    check_requirements
    info "Démarrage du premier déploiement ÉcolePro..."

    # Générer les secrets JWT si absents
    if grep -q "remplacer_par_openssl" .env; then
        JWT=$(openssl rand -hex 32)
        JWTREF=$(openssl rand -hex 32)
        sed -i "s/remplacer_par_openssl_rand_hex_32_ici_minimum_64_caracteres/$JWT/" .env
        sed -i "s/autre_secret_different_du_jwt_secret_openssl_rand_hex_32/$JWTREF/" .env
        info "Secrets JWT générés automatiquement"
    fi

    # Créer les dossiers nécessaires
    mkdir -p nginx/ssl frontend scripts

    # SSL auto-signé pour dev (remplacer par Let's Encrypt en prod)
    if [ ! -f nginx/ssl/fullchain.pem ]; then
        warning "Génération d'un certificat SSL auto-signé (développement)..."
        openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
            -keyout nginx/ssl/privkey.pem \
            -out nginx/ssl/fullchain.pem \
            -subj "/C=CI/ST=Abidjan/O=EcolePro/CN=ecolepro.ci" 2>/dev/null
        info "Certificat SSL auto-signé créé (valable 365 jours)"
    fi

    # Build & démarrage
    $COMPOSE build --no-cache
    $COMPOSE up -d
    info "Attente du démarrage des services..."
    sleep 8

    # Initialiser la base de données
    db_init
    info "Déploiement terminé ! Accès : https://localhost"
}

# ── Mise à jour (zero-downtime) ───────────────────────────
deploy() {
    check_requirements
    info "Mise à jour en cours..."

    # Rebuild l'API sans couper le service
    $COMPOSE build api pdf-service
    $COMPOSE up -d --no-deps api pdf-service
    info "API et service PDF mis à jour"

    # Recharger Nginx sans coupure
    $COMPOSE exec nginx nginx -s reload
    info "Nginx rechargé"

    info "Mise à jour terminée"
}

# ── Initialisation de la base de données ─────────────────
db_init() {
    info "Initialisation de la base de données..."
    $COMPOSE exec -T postgres psql \
        -U "$($COMPOSE exec -T postgres printenv POSTGRES_USER)" \
        -d "$($COMPOSE exec -T postgres printenv POSTGRES_DB)" \
        < scripts/schema.sql
    info "Schéma SQL appliqué"
}

# ── Sauvegarde PostgreSQL ─────────────────────────────────
backup() {
    DATE=$(date +%Y%m%d_%H%M%S)
    BACKUP_DIR="./backups"
    mkdir -p "$BACKUP_DIR"
    FILENAME="$BACKUP_DIR/ecolepro_${DATE}.sql.gz"

    info "Sauvegarde de la base de données → $FILENAME"
    $COMPOSE exec -T postgres pg_dump \
        -U "$($COMPOSE exec -T postgres printenv POSTGRES_USER)" \
        "$($COMPOSE exec -T postgres printenv POSTGRES_DB)" \
        | gzip > "$FILENAME"

    info "Sauvegarde terminée : $FILENAME"

    # Supprimer les sauvegardes > 30 jours
    find "$BACKUP_DIR" -name "*.sql.gz" -mtime +30 -delete
    info "Sauvegardes > 30 jours supprimées"
}

# ── Restauration ──────────────────────────────────────────
restore() {
    [ -z "$1" ] && error "Usage : ./deploy.sh restore <fichier.sql.gz>"
    [ -f "$1" ] || error "Fichier $1 introuvable"

    warning "ATTENTION : Cette opération va écraser la base de données actuelle !"
    read -rp "Confirmer ? (oui/non) : " CONFIRM
    [ "$CONFIRM" = "oui" ] || { info "Annulé"; exit 0; }

    info "Restauration depuis $1..."
    gunzip -c "$1" | $COMPOSE exec -T postgres psql \
        -U "$($COMPOSE exec -T postgres printenv POSTGRES_USER)" \
        "$($COMPOSE exec -T postgres printenv POSTGRES_DB)"
    info "Restauration terminée"
}

# ── Logs ─────────────────────────────────────────────────
logs() {
    SERVICE=${1:-""}
    $COMPOSE logs -f --tail=100 $SERVICE
}

# ── Statut des services ───────────────────────────────────
status() {
    info "État des conteneurs :"
    $COMPOSE ps
    echo ""
    info "Utilisation des ressources :"
    docker stats --no-stream \
        ecolepro_nginx ecolepro_api ecolepro_pdf \
        ecolepro_postgres ecolepro_redis 2>/dev/null || true
}

# ── SSL Let's Encrypt (production) ───────────────────────
ssl_renew() {
    DOMAIN=$(grep DOMAIN .env | cut -d= -f2)
    info "Renouvellement SSL pour $DOMAIN..."
    docker run --rm \
        -v "$(pwd)/nginx/ssl:/etc/letsencrypt" \
        -v "$(pwd)/nginx/certbot:/var/www/certbot" \
        certbot/certbot certonly --webroot \
        -w /var/www/certbot \
        -d "$DOMAIN" -d "www.$DOMAIN" \
        --non-interactive --agree-tos \
        --email "admin@$DOMAIN"
    $COMPOSE exec nginx nginx -s reload
    info "Certificat renouvelé"
}

# ── Arrêt complet ─────────────────────────────────────────
stop()    { $COMPOSE down; info "Services arrêtés"; }
restart() { $COMPOSE restart "$1"; info "Redémarrage de ${1:-tous les services}"; }
clean()   {
    warning "Suppression des volumes et conteneurs..."
    $COMPOSE down -v
    info "Nettoyage terminé"
}

# ── Dispatcher ───────────────────────────────────────────
case "${1:-help}" in
    setup)    setup ;;
    deploy)   deploy ;;
    backup)   backup ;;
    restore)  restore "$2" ;;
    db-init)  db_init ;;
    logs)     logs "$2" ;;
    status)   status ;;
    ssl)      ssl_renew ;;
    stop)     stop ;;
    restart)  restart "$2" ;;
    clean)    clean ;;
    help|*)
        echo ""
        echo "  ÉcolePro — Script de gestion Docker"
        echo ""
        echo "  ./deploy.sh setup            Premier déploiement complet"
        echo "  ./deploy.sh deploy           Mise à jour sans coupure"
        echo "  ./deploy.sh backup           Sauvegarder la base de données"
        echo "  ./deploy.sh restore <file>   Restaurer une sauvegarde"
        echo "  ./deploy.sh db-init          Réinitialiser le schéma SQL"
        echo "  ./deploy.sh logs [service]   Suivre les logs"
        echo "  ./deploy.sh status           État des services + ressources"
        echo "  ./deploy.sh ssl              Renouveler le certificat Let's Encrypt"
        echo "  ./deploy.sh stop             Arrêter tous les services"
        echo "  ./deploy.sh restart [svc]    Redémarrer un service"
        echo "  ./deploy.sh clean            Supprimer conteneurs + volumes"
        echo ""
        ;;
esac
