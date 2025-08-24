FROM nginx:stable-alpine

# Copy HTML, CSS, JS into nginx web root
COPY . /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
