# 🎙️ Discord AI Voice Registration & Biometrics Bot

[Turkish (Türkçe) açıklamalar için aşağı kaydırın.](#tr-türkçe-açıklama)

An advanced, standalone Discord bot that uses the **Gemini Multimodal API** to automate member registration through voice speech. It listens to members joining a voice channel, transcribes their spoken name and age, detects gender, assigns roles, and implements voice biometrics to prevent duplicate registrations (alt accounts) and identity fraud.

---

## 🌟 Features

* **Speech-to-Text & Extraction:** Powered by Gemini (e.g. `gemini-2.5-flash`), the bot records user voice, transcribes it, and extracts their Name, Age, and Gender.
* **Auto Rename & Role Management:** Automatically renames the member to `Tag Name | Age` and assigns the corresponding Male/Female roles, while removing the Unregistered role.
* **Voice Biometrics (Identity Verification):**
  * **Alt Account Detection:** Compares the speaker's voice with the last 5 registered users. If a similarity score is $\ge 85\%$, it blocks the registration as a potential alt account.
  * **Original Name Enforcement:** If the user has registered before, it compares their voice with their original voice sample. If it matches, they are automatically registered with their **first registered name**, ignoring any different name they say. If it doesn't match, the request is blocked.
* **Multi-Model Fallback:** Dynamic fallback loop over multiple Gemini models (`gemini-2.5-flash`, `gemini-2.0-flash`, `gemini-flash-latest`) to bypass rate limits or spikes in API demand.
* **Voice E2EE Support:** Pre-configured with `@snazzah/davey` and `libsodium-wrappers` to satisfy Discord's end-to-end voice encryption handshakes.

---

## ⚙️ Configuration & Installation

### Requirements
* **Node.js** v18.0.0 or higher.
* A **MongoDB** database.
* A **Gemini API Key** (from Google AI Studio).

### Installation Steps
1. Clone or download this repository:
   ```bash
   cd discord-ai-voice-register
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy the `.env` template and fill in your values:
   - Bot Token, Client/Guild IDs
   - Voice and Log Channel IDs
   - Role IDs (Male, Female, Unregistered)
   - Mongo URI & Gemini API Key
4. Run the bot:
   ```bash
   npm start
   ```

---

<div id="tr-türkçe-açıklama"></div>

# 🎙️ Discord Yapay Zeka Sesli Kayıt ve Biyometri Botu

Sesli konuşma yoluyla üye kaydını otomatikleştirmek için **Gemini Çok Modlu API**'sini kullanan gelişmiş, bağımsız bir Discord botu. Bir ses kanalına katılan üyeleri dinler, söyledikleri isim ve yaş verilerini metne dökerek cinsiyetlerini algılar, rolleri dağıtır ve çift kayıtları (yan hesapları) engellemek için ses biyometrisi uygular.

---

## 🌟 Özellikler

* **Ses Analizi ve Veri Çıkarma:** Gemini API (`gemini-2.5-flash`) desteği ile bot üye sesini kaydeder, metne döker, İsim, Yaş ve Cinsiyet verilerini çıkartır.
* **Otomatik Nickname ve Rol Yönetimi:** Üyeyi otomatik olarak `Tag İsim | Yaş` şeklinde adlandırır, Erkek/Kadın rollerini verir ve Kayıtsız rolünü alır.
* **Ses Biyometrisi (Kimlik Doğrulama):**
  * **Çift Kayıt / Alt Hesap Algılama:** Konuşan kişinin sesini son kayıt olan 5 üye ile karşılaştırır. Benzerlik skoru $\ge 85\%$ ise kaydı bloke eder.
  * **Orijinal İsim Dayatması:** Eğer kullanıcı daha önce kayıt olduysa, sesi eski ses örneğiyle doğrulanır. Eşleşirse, mikrofonda ne söylerse söylesin otomatik olarak **ilk kayıt olduğu ismiyle** tekrar kaydedilir. Ses eşleşmezse engellenir.
* **Çoklu Model Yedekleme (Fallback):** API kota limitlerini aşmak için birden fazla Gemini modeli sırasıyla denenir.

---

## ⚙️ Kurulum ve Yapılandırma

### Gereksinimler
* **Node.js** v18.0.0 veya üzeri.
* Bir **MongoDB** veritabanı.
* Bir **Gemini API Anahtarı** (Google AI Studio üzerinden ücretsiz alınabilir).

### Kurulum Adımları
1. Proje dizinine girin:
   ```bash
   cd discord-ai-voice-register
   ```
2. Bağımlılıkları yükleyin:
   ```bash
   npm install
   ```
3. `.env` dosyasını oluşturun ve bilgilerinizi doldurun (Bot Token, Rol ID'leri, Gemini Key, Mongo URI vb.).
4. Botu çalıştırın:
   ```bash
   npm start
   ```

---
*Developed by **[Tormund / Tormund0](https://github.com/Tormund0)***
