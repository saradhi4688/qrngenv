# Use a lightweight web server image
FROM nginx:alpine

# Copy your frontend code (HTML, JS, CSS) into nginx public folder
COPY . /usr/share/nginx/html

# Expose port 80 for serving frontend
EXPOSE 80

# Nginx will automatically start when the container runs
