import requests
from bs4 import BeautifulSoup

# --- Prix de référence ---
REFERENCE_30ML = 170.0
REFERENCE_50ML = 265.0

# --- Fonctions utilitaires ---

def check_discount(current_price, reference_price):
    """
    Retourne True si le prix actuel représente une réduction >= 5%
    par rapport au prix de référence.
    (Au lieu de 20% comme avant.)
    """
    if reference_price == 0:
        return False
    discount_percentage = (1 - (current_price / reference_price)) * 100
    return discount_percentage >= 5

def parse_price(text):
    """
    Extrait un prix (float) à partir d'un texte, ex. "289,99 €", "289 €", "289.99 EUR".
    """
    text = text.replace(",", ".").replace(" ", "")
    filtered = "".join(ch for ch in text if ch.isdigit() or ch == ".")
    try:
        return float(filtered)
    except:
        return None

def find_potential_price_in_text(full_text):
    """
    Cherche un fragment ressemblant à un prix dans un gros bloc (i.e. contenant '€'),
    et renvoie la première occurrence convertie en float. Sinon None.
    """
    for chunk in full_text.split():
        if "€" in chunk or "eur" in chunk.lower():
            price_val = parse_price(chunk)
            if price_val:
                return price_val
    return None

def detect_size_and_ref(text):
    """
    Détecte si c'est 30 ml ou 50 ml, 
    en ignorant les mentions 15 ml / 15ml / travel size, etc.
    
    Retourne (size, reference_price) ou (None, 0) si rien n'est trouvé ou si c'est un format non géré.
    """
    lower = text.lower()
    # On ignore complètement si c'est du 15 ml ou travel size
    # (souvent 15 ml n'est pas la contenance recherchée)
    if "15ml" in lower or "15 ml" in lower or "travel" in lower:
        return None, 0

    if "30ml" in lower or "30 ml" in lower:
        return "30 ml", REFERENCE_30ML
    elif "50ml" in lower or "50 ml" in lower:
        return "50 ml", REFERENCE_50ML
    else:
        return None, 0

# --- Fonctions de scraping (une par site) ---

def scrape_augustinusbader():
    results = []
    site_name = "Augustinus Bader (Officiel)"
    url = "https://augustinusbader.com/eu/en/the-cream-50-ml"

    try:
        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        full_text = soup.get_text(separator=" ")
        # On veut "The Cream" (pas "The Rich Cream") 
        # => on vérifie la mention "The Cream"
        if "The Cream" in full_text and "Rich Cream" not in full_text:
            size, ref_price = detect_size_and_ref(full_text)
            if size and ref_price > 0:
                price_found = find_potential_price_in_text(full_text)
                if price_found and check_discount(price_found, ref_price):
                    results.append({
                        "site": site_name,
                        "url": url,
                        "product": f"The Cream {size}",
                        "size": size,
                        "current_price": price_found,
                        "reference_price": ref_price,
                    })
    except Exception as e:
        print(f"[{site_name}] Erreur: {e}")

    return results

def scrape_sephora():
    results = []
    site_name = "Sephora France"
    url = "https://www.sephora.fr/p/the-cream-P10010288.html"

    try:
        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        full_text = soup.get_text(separator=" ")
        if "The Cream" in full_text and "Rich Cream" not in full_text and "Augustinus Bader" in full_text:
            size, ref_price = detect_size_and_ref(full_text)
            if size and ref_price > 0:
                price_found = find_potential_price_in_text(full_text)
                if price_found and check_discount(price_found, ref_price):
                    results.append({
                        "site": site_name,
                        "url": url,
                        "product": f"The Cream {size}",
                        "size": size,
                        "current_price": price_found,
                        "reference_price": ref_price,
                    })
    except Exception as e:
        print(f"[{site_name}] Erreur: {e}")

    return results

def scrape_marionnaud():
    results = []
    site_name = "Marionnaud France"
    url = "https://www.marionnaud.fr/soin-visage/creme-de-jour/the-cream-50ml/p/BP_123456"

    try:
        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        full_text = soup.get_text(separator=" ")
        if "The Cream" in full_text and "Rich Cream" not in full_text and "Augustinus Bader" in full_text:
            size, ref_price = detect_size_and_ref(full_text)
            if size:
                price_found = find_potential_price_in_text(full_text)
                if price_found and check_discount(price_found, ref_price):
                    results.append({
                        "site": site_name,
                        "url": url,
                        "product": f"The Cream {size}",
                        "size": size,
                        "current_price": price_found,
                        "reference_price": ref_price,
                    })
    except Exception as e:
        print(f"[{site_name}] Erreur: {e}")

    return results

def scrape_nocibe():
    results = []
    site_name = "Nocibé"
    url = "https://www.nocibe.fr/augustinus-bader-the-cream-50ml/p/123456"

    try:
        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        full_text = soup.get_text(separator=" ")
        if "The Cream" in full_text and "Rich Cream" not in full_text and "Augustinus Bader" in full_text:
            size, ref_price = detect_size_and_ref(full_text)
            if size:
                price_found = find_potential_price_in_text(full_text)
                if price_found and check_discount(price_found, ref_price):
                    results.append({
                        "site": site_name,
                        "url": url,
                        "product": f"The Cream {size}",
                        "size": size,
                        "current_price": price_found,
                        "reference_price": ref_price,
                    })
    except Exception as e:
        print(f"[{site_name}] Erreur: {e}")

    return results

def scrape_ohmycream():
    results = []
    site_name = "Oh My Cream"
    url = "https://en.ohmycream.com/products/the-rich-cream-creme-anti-age-riche"
    # Remarque : L'URL mentionne "Rich Cream", mais on va quand même regarder
    # le code filtrera "Rich Cream" => donc en théorie ça ne devrait rien remonter.
    # À ajuster si vous voulez aussi suivre "The Rich Cream".
    try:
        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        full_text = soup.get_text(separator=" ")
        # Filtre "The Cream" (exclut "Rich Cream")
        if "The Cream" in full_text and "Rich Cream" not in full_text and "Augustinus Bader" in full_text:
            size, ref_price = detect_size_and_ref(full_text)
            if size:
                price_found = find_potential_price_in_text(full_text)
                if price_found and check_discount(price_found, ref_price):
                    results.append({
                        "site": site_name,
                        "url": url,
                        "product": f"The Cream {size}",
                        "size": size,
                        "current_price": price_found,
                        "reference_price": ref_price,
                    })
    except Exception as e:
        print(f"[{site_name}] Erreur: {e}")

    return results

def scrape_printemps():
    results = []
    site_name = "Printemps"
    url = "https://www.printemps.com/fr/fr/augustinus-bader-the-cream-50ml-1234567"

    try:
        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        full_text = soup.get_text(separator=" ")
        if "The Cream" in full_text and "Rich Cream" not in full_text and "Augustinus Bader" in full_text:
            size, ref_price = detect_size_and_ref(full_text)
            if size:
                price_found = find_potential_price_in_text(full_text)
                if price_found and check_discount(price_found, ref_price):
                    results.append({
                        "site": site_name,
                        "url": url,
                        "product": f"The Cream {size}",
                        "size": size,
                        "current_price": price_found,
                        "reference_price": ref_price,
                    })
    except Exception as e:
        print(f"[{site_name}] Erreur: {e}")

    return results

def scrape_noseparis():
    results = []
    site_name = "NOSE Paris"
    url = "https://noseparis.com/fr/the-cream"

    try:
        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        full_text = soup.get_text(separator=" ")
        if "The Cream" in full_text and "Rich Cream" not in full_text and "Augustinus Bader" in full_text:
            size, ref_price = detect_size_and_ref(full_text)
            if size:
                price_found = find_potential_price_in_text(full_text)
                if price_found and check_discount(price_found, ref_price):
                    results.append({
                        "site": site_name,
                        "url": url,
                        "product": f"The Cream {size}",
                        "size": size,
                        "current_price": price_found,
                        "reference_price": ref_price,
                    })
    except Exception as e:
        print(f"[{site_name}] Erreur: {e}")

    return results

def scrape_lookfantastic():
    results = []
    site_name = "Lookfantastic"
    url = "https://www.lookfantastic.fr/augustinus-bader-the-cream-50ml/12345678.html"

    try:
        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        full_text = soup.get_text(separator=" ")
        if "The Cream" in full_text and "Rich Cream" not in full_text and "Augustinus Bader" in full_text:
            size, ref_price = detect_size_and_ref(full_text)
            if size:
                price_found = find_potential_price_in_text(full_text)
                if price_found and check_discount(price_found, ref_price):
                    results.append({
                        "site": site_name,
                        "url": url,
                        "product": f"The Cream {size}",
                        "size": size,
                        "current_price": price_found,
                        "reference_price": ref_price,
                    })
    except Exception as e:
        print(f"[{site_name}] Erreur: {e}")

    return results

def scrape_cultbeauty():
    results = []
    site_name = "Cult Beauty"
    url = "https://www.cultbeauty.co.uk/augustinus-bader-the-cream-50ml.html"

    try:
        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        full_text = soup.get_text(separator=" ")
        if "The Cream" in full_text and "Rich Cream" not in full_text and "Augustinus Bader" in full_text:
            size, ref_price = detect_size_and_ref(full_text)
            if size:
                price_found = find_potential_price_in_text(full_text)
                if price_found and check_discount(price_found, ref_price):
                    results.append({
                        "site": site_name,
                        "url": url,
                        "product": f"The Cream {size}",
                        "size": size,
                        "current_price": price_found,
                        "reference_price": ref_price,
                    })
    except Exception as e:
        print(f"[{site_name}] Erreur: {e}")

    return results

def scrape_netaporter():
    results = []
    site_name = "Net-A-Porter"
    url = "https://www.net-a-porter.com/en-fr/shop/product/augustinus-bader/the-cream-50ml/1234567"

    try:
        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        full_text = soup.get_text(separator=" ")
        if "The Cream" in full_text and "Rich Cream" not in full_text and "Augustinus Bader" in full_text:
            size, ref_price = detect_size_and_ref(full_text)
            if size:
                price_found = find_potential_price_in_text(full_text)
                if price_found and check_discount(price_found, ref_price):
                    results.append({
                        "site": site_name,
                        "url": url,
                        "product": f"The Cream {size}",
                        "size": size,
                        "current_price": price_found,
                        "reference_price": ref_price,
                    })
    except Exception as e:
        print(f"[{site_name}] Erreur: {e}")

    return results

def scrape_beautylish():
    results = []
    site_name = "Beautylish"
    url = "https://www.beautylish.com/s/augustinus-bader-the-cream-50ml"

    try:
        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        full_text = soup.get_text(separator=" ")
        if "The Cream" in full_text and "Rich Cream" not in full_text and "Augustinus Bader" in full_text:
            size, ref_price = detect_size_and_ref(full_text)
            if size:
                price_found = find_potential_price_in_text(full_text)
                if price_found and check_discount(price_found, ref_price):
                    results.append({
                        "site": site_name,
                        "url": url,
                        "product": f"The Cream {size}",
                        "size": size,
                        "current_price": price_found,
                        "reference_price": ref_price,
                    })
    except Exception as e:
        print(f"[{site_name}] Erreur: {e}")

    return results

def scrape_libertylondon():
    results = []
    site_name = "Liberty London"
    url = "https://www.libertylondon.com/fr/augustinus-bader-the-cream-50ml-123456.html"

    try:
        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        full_text = soup.get_text(separator=" ")
        if "The Cream" in full_text and "Rich Cream" not in full_text and "Augustinus Bader" in full_text:
            size, ref_price = detect_size_and_ref(full_text)
            if size:
                price_found = find_potential_price_in_text(full_text)
                if price_found and check_discount(price_found, ref_price):
                    results.append({
                        "site": site_name,
                        "url": url,
                        "product": f"The Cream {size}",
                        "size": size,
                        "current_price": price_found,
                        "reference_price": ref_price,
                    })
    except Exception as e:
        print(f"[{site_name}] Erreur: {e}")

    return results

def scrape_mecca():
    results = []
    site_name = "MECCA"
    url = "https://www.mecca.com.au/augustinus-bader/the-cream/I-123456.html"

    try:
        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        full_text = soup.get_text(separator=" ")
        if "The Cream" in full_text and "Rich Cream" not in full_text and "Augustinus Bader" in full_text:
            size, ref_price = detect_size_and_ref(full_text)
            if size:
                price_found = find_potential_price_in_text(full_text)
                if price_found and check_discount(price_found, ref_price):
                    results.append({
                        "site": site_name,
                        "url": url,
                        "product": f"The Cream {size}",
                        "size": size,
                        "current_price": price_found,
                        "reference_price": ref_price,
                    })
    except Exception as e:
        print(f"[{site_name}] Erreur: {e}")

    return results

def scrape_douglas():
    results = []
    site_name = "Douglas"
    url = "https://www.douglas.fr/fr/p/augustinus-bader-the-cream-50ml/3001048576"

    try:
        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        full_text = soup.get_text(separator=" ")
        if "The Cream" in full_text and "Rich Cream" not in full_text and "Augustinus Bader" in full_text:
            size, ref_price = detect_size_and_ref(full_text)
            if size:
                price_found = find_potential_price_in_text(full_text)
                if price_found and check_discount(price_found, ref_price):
                    results.append({
                        "site": site_name,
                        "url": url,
                        "product": f"The Cream {size}",
                        "size": size,
                        "current_price": price_found,
                        "reference_price": ref_price,
                    })
    except Exception as e:
        print(f"[{site_name}] Erreur: {e}")

    return results

def scrape_merci():
    results = []
    site_name = "Merci"
    url = "https://merci-merci.com/en/collections/marque-augustinus-bader"

    try:
        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        full_text = soup.get_text(separator=" ")
        if "The Cream" in full_text and "Rich Cream" not in full_text and "Augustinus Bader" in full_text:
            size, ref_price = detect_size_and_ref(full_text)
            if size:
                price_found = find_potential_price_in_text(full_text)
                if price_found and check_discount(price_found, ref_price):
                    results.append({
                        "site": site_name,
                        "url": url,
                        "product": f"The Cream {size}",
                        "size": size,
                        "current_price": price_found,
                        "reference_price": ref_price,
                    })
    except Exception as e:
        print(f"[{site_name}] Erreur: {e}")

    return results


def main():
    """
    Appelle les 15 fonctions de scraping,
    compile les offres détectées (réduc >= 5%),
    génère index.html (mise en page simple, responsive).
    """
    all_offers = []

    # 1. Appeler toutes les fonctions
    all_offers.extend(scrape_augustinusbader())
    all_offers.extend(scrape_sephora())
    all_offers.extend(scrape_marionnaud())
    all_offers.extend(scrape_nocibe())
    all_offers.extend(scrape_ohmycream())
    all_offers.extend(scrape_printemps())
    all_offers.extend(scrape_noseparis())
    all_offers.extend(scrape_lookfantastic())
    all_offers.extend(scrape_cultbeauty())
    all_offers.extend(scrape_netaporter())
    all_offers.extend(scrape_beautylish())
    all_offers.extend(scrape_libertylondon())
    all_offers.extend(scrape_mecca())
    all_offers.extend(scrape_douglas())
    all_offers.extend(scrape_merci())

    # 2. Génération HTML
    with open("index.html", "w", encoding="utf-8") as f:
        f.write("<!DOCTYPE html><html lang='fr'>\n")
        f.write("<head>\n")
        f.write("  <meta charset='UTF-8'/>\n")
        f.write("  <meta name='viewport' content='width=device-width, initial-scale=1.0'/>\n")
        f.write("  <title>Offres Augustinus Bader – The Cream</title>\n")
        f.write("""
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      max-width: 600px; 
      margin: 20px auto; 
      padding: 10px; 
      line-height: 1.5; 
      color: #333; 
      background: #fff;
    }
    h1 {
      font-size: 1.4em; 
      margin-bottom: 0.5em; 
      text-align: center;
    }
    .offers-list {
      list-style: none; 
      padding: 0; 
      margin: 0;
    }
    .offer {
      background: #f9f9f9; 
      border-radius: 6px; 
      margin-bottom: 1em; 
      padding: 10px 14px;
    }
    .offer strong {
      color: #0072E5;
    }
    .offer a {
      color: #0072E5; 
      text-decoration: none;
    }
    .offer a:hover {
      text-decoration: underline;
    }
    .no-offers {
      margin-top: 2em; 
      text-align: center; 
      color: #999; 
    }
    footer {
      text-align: center; 
      margin-top: 30px;
      font-size: 0.85em;
      color: #666;
    }
  </style>
        """)
        f.write("</head>\n<body>\n")

        f.write("<h1>Offres Augustinus Bader – The Cream</h1>\n")

        if all_offers:
            f.write("<ul class='offers-list'>\n")
            for o in all_offers:
                line = f"""
<li class='offer'>
  <div><strong>{o['product']}</strong> – {o['current_price']:.2f}€ 
    (référence : {o['reference_price']:.2f}€)</div>
  <div>Site : <a href="{o['url']}" target="_blank">{o['site']}</a></div>
</li>
"""
                f.write(line)
            f.write("</ul>\n")
        else:
            f.write("<p class='no-offers'>Aucune offre trouvée avec 5% de réduction ou plus.</p>\n")

        f.write("<footer>Mis à jour automatiquement, 2 fois par jour.</footer>\n")
        f.write("</body></html>\n")

if __name__ == "__main__":
    main()