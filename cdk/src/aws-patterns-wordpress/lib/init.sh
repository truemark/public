#!/usr/bin/env bash

echo "-------------------------------------------------------------------------------"
echo "Starting Initialization"
echo "-------------------------------------------------------------------------------"

set -euo pipefail

export PHP_VERSION="{{PHP_VERSION}}"
export DATA_MOUNT="/srv"
export DEBIAN_FRONTEND="noninteractive"



# Add motd
cat <<-EOF > /etc/motd
UNAUTHORIZED ACCESS TO THIS DEVICE IS PROHIBITED

You must have explicit, authorized permission to access or configure this
device. Unauthorized attempts and actions to access or use this system may
result in civil and/or criminal penalties. All activities performed on this
device are logged and monitored.

WARNING: DO NOT TREAT THIS SYSTEM AS A PET!!

Any files created outside of /srv will be destroyed. Only files that are stored
in /srv will remain persistent. If you require additional dependencies or
configurations to this system beyond files in /srv, please contact support.
EOF

# Add user
echo "Adding wordpress user..."
useradd -m -g www-data -u 2000 -s /bin/bash wordpress
# TODO Add additional authorized-keys file
# TODO Set password from secret
# TODO Add fail2ban support

# Update SSH Settings
echo "Updating SSH settings..."
cat <<-EOF >> /etc/ssh/sshd_config
MaxAuthTries 3
Port 22
Port 2020
PermitEmptyPasswords no
X11Forwarding no
PrintMotd yes
EOF
systemctl restart sshd

# Dependencies and updates
echo "Applying updates and installing dependencies..."
apt-get update -qq && apt-get -y upgrade && apt-get install -qq zip unzip jq haveged mysql-client-8.0
echo "Restarting services..."
systemctl daemon-reexec
for svc in $(needrestart -b -r l | grep NEEDRESTART-SVC | awk '{print $2}'); do
  systemctl restart ${svc/.service/};
done

# Install AWS CLI v2
echo "Installing AWS CLI v2..."
curl -s "https://awscli.amazonaws.com/awscli-exe-linux-$(uname -m).zip" -o awscliv2.zip
unzip -qq awscliv2.zip && ./aws/install && rm -f awscliv2.zip && rm -rf aws

# Install osquery
echo "Installing osquery..."
apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys "1484120AC4E9F8A1A577AEEE97A80C63C9D8B80B"
add-apt-repository "deb [arch=$([[ $(uname -m) = "aarch64" ]] && echo "arm64" || echo "amd64")] https://pkg.osquery.io/deb deb main"
apt-get -qq update && apt-get -qq install osquery

# Install tmdisk
echo "Installing tmdisk..."
bash <(curl -sL https://raw.githubusercontent.com/truemark/tmdisk/master/install)

# Get metadata
echo "Fetching metadata..."
REGION=$(osqueryi "select region from ec2_instance_metadata" --json | jq -r '.[].region')
echo "Running in ${REGION}"
INSTANCE_ID=$(osqueryi "select instance_id from ec2_instance_metadata" --json | jq -r '.[].instance_id')
echo "Instance ID is ${INSTANCE_ID}"

# Mount the volume
VOLUME_ID=$(aws ec2 describe-tags --filters "Name=resource-id,Values=${INSTANCE_ID}" --filter "Name=key,Values=wordpress:data-volume" --region "${REGION}" --output text --query 'Tags[0].Value')
echo "Waiting for volume ${VOLUME_ID} to become available..."
aws ec2 wait volume-available --volume-id ${VOLUME_ID}
echo "Attaching volume ${VOLUME_ID} to instance ${INSTANCE_ID}"
aws ec2 attach-volume --device '/dev/sdf' --instance-id "${INSTANCE_ID}" --volume-id "${VOLUME_ID}"
echo "Waiting for volume ${VOLUME_ID} to become attached..."
aws ec2 wait volume-in-use --volume-ids "${VOLUME_ID}"
DISK="$(tmdisk 1)"
if [[ "${DISK}" == "" ]]; then echo "Failed to locate disk"; exit 1; fi
echo "Volume ${VOLUME_ID} is mapped to disk ${DISK}"
set +o pipefail
TYPE="$(blkid "${DISK}" | awk -F "=" '{gsub(/"/, ""); print $NF}')"
set -o pipefail
echo "Filesystem on ${DISK} is ${TYPE}"
[[ "${TYPE}" == "" ]] && mkfs.ext4 "${DISK}"
echo "Mounting ${DISK} to ${DATA_MOUNT}..."
mkdir -p ${DATA_MOUNT} && mount ${DISK} ${DATA_MOUNT}
echo "Resizing ${DISK}..."
resize2fs ${DISK}

# Install and configure Apache and PHP
echo "Installing Apache and PHP ${PHP_VERSION}..."
apt-get install -qq software-properties-common apt-transport-https
add-apt-repository ppa:ondrej/php -y
add-apt-repository ppa:ondrej/apache2 -y
#apt-get install -qq php${PHP_VERSION} libapache2-mod-php${PHP_VERSION} $(apt-cache search ^php${PHP_VERSION}- | grep "^php${PHP_VERSION}" | grep -v "yac" | grep -v "magick" | sed "s/ .*//g" | tr '\n' ' ')
apt-get install -qq \
php${PHP_VERSION} \
libapache2-mod-php${PHP_VERSION} \
php${PHP_VERSION}-bcmath \
php${PHP_VERSION}-bz2 \
php${PHP_VERSION}-cgi \
php${PHP_VERSION}-cli \
php${PHP_VERSION}-common \
php${PHP_VERSION}-curl \
php${PHP_VERSION}-gd \
php${PHP_VERSION}-gmp \
php${PHP_VERSION}-imap \
php${PHP_VERSION}-interbase \
php${PHP_VERSION}-intl \
php${PHP_VERSION}-ldap \
php${PHP_VERSION}-mbstring \
php${PHP_VERSION}-mysql \
php${PHP_VERSION}-odbc \
php${PHP_VERSION}-opcache \
php${PHP_VERSION}-pgsql \
php${PHP_VERSION}-readline \
php${PHP_VERSION}-snmp \
php${PHP_VERSION}-ssh2 \
php${PHP_VERSION}-soap \
php${PHP_VERSION}-sqlite3 \
php${PHP_VERSION}-sybase \
php${PHP_VERSION}-tidy \
php${PHP_VERSION}-xml \
php${PHP_VERSION}-xsl \
php${PHP_VERSION}-zip

cat <<-EOF > /etc/php/${PHP_VERSION}/apache2/conf.d/999-custom.ini
[PHP]
upload_max_filesize = 1G
post_max_size = 1G
memory_limit = 320M
EOF

ln -s /etc/apache2/mods-available/remoteip.load /etc/apache2/mods-enabled/remoteip.load

cat <<-EOF > /etc/apache2/sites-enabled/000-default.conf
<VirtualHost *:80>
  <Location />
  Order deny,allow
  Deny from all
  </Location>
</VirtualHost>
EOF

cat <<-EOF > /etc/apache2/conf-enabled/security.conf
ServerTokens Prod
ServerSignature Off
TraceEnable Off
LimitRequestBody 1073741824
SetEnvIf X-Forwarded-Proto "https" HTTPS=on
SetEnvIf Cloudfront-Forwarded-Proto "https" HTTPS=on
SetEnvIf X-Forwarded-Proto "https" REQUEST_SCHEME=https
SetEnvIf Cloudfront-Forwarded-Proto "https" REQUEST_SCHEME=https
RemoteIPHeader  X-Forwarded-For
RemoteIPTrustedProxy 10.0.0.0/8
RemoteIPTrustedProxy 172.16.0.0/12
RemoteIPTrustedProxy 192.168.0.0/16
RemoteIPTrustedProxy fc00::/7
RemoteIPTrustedProxy fd00::/8
RemoteIPTrustedProxy fec0::/10
EOF

CLOUDFRONT_IPS=$(curl -s http://d7uri8nf7uskq.cloudfront.net/tools/list-cloudfront-ips)
for ip in $(echo "${CLOUDFRONT_IPS}" | jq -r ".CLOUDFRONT_REGIONAL_EDGE_IP_LIST[]"); do
  echo "RemoteIPTrustedProxy ${ip}" >> /etc/apache2/conf-enabled/security.conf
done
for ip in $(echo "${CLOUDFRONT_IPS}" | jq -r ".CLOUDFRONT_GLOBAL_IP_LIST[]"); do
  echo "RemoteIPTrustedProxy ${ip}" >> /etc/apache2/conf-enabled/security.conf
done

# Reset permissions on root directory to defaults just in case
chown wordpress:www-data /srv
chmod 755 /srv

echo "Testing Apache configuration..."
apache2ctl configtest
echo "Reloading Apache configuration"
service apache2 reload

# Install WP-CLI
curl -s -O https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar
php wp-cli.phar --info
chmod +x wp-cli.phar
mv wp-cli.phar /usr/local/bin/wp

## Setup Sites
SITES=$(aws ec2 describe-tags --filters "Name=resource-id,Values=${INSTANCE_ID}" --filter "Name=key,Values=wordpress:sites" --region "${REGION}" --output text --query 'Tags[0].Value')
for site in ${SITES}; do
  SITE_DIR="${DATA_MOUNT}/${site}"
  mkdir -p "${SITE_DIR}"
  chown wordpress:www-data "${SITE_DIR}"
  if [[ ! -e "${SITE_DIR}/index.php" ]]; then
    echo "Installing WordPress for ${site}"
    curl -s https://wordpress.org/latest.tar.gz | sudo -u wordpress tar zx --strip-components=1 -C "${SITE_DIR}"
  fi
  cat <<-EOF > "/etc/apache2/sites-enabled/${site}.conf"
  <VirtualHost *:80>
      ServerName ${site}
      ServerAlias www.${site}
      DocumentRoot "${SITE_DIR}"
      <Directory "${SITE_DIR}">
          Require all granted
          DirectoryIndex index.php
          AllowOverride FileInfo
          FallbackResource /index.php
      </Directory>
      <Directory "${SITE_DIR}/wp-admin">
          FallbackResource disabled
      </Directory>
  </VirtualHost>
EOF
done

echo "Testing Apache configuration..."
apache2ctl configtest
echo "Reloading Apache configuration"
service apache2 reload

EIP_ALLOCATION_ID=$(aws ec2 describe-tags --filters "Name=resource-id,Values=${INSTANCE_ID}" --filter "Name=key,Values=wordpress:eip-allocation-id" --region "${REGION}" --output text --query 'Tags[0].Value')
aws ec2 associate-address --allocation-id "${EIP_ALLOCATION_ID}" --instance-id "${INSTANCE_ID}" --allow-reassociation

echo "-------------------------------------------------------------------------------"
echo "Initialization Complete"
echo "-------------------------------------------------------------------------------"
