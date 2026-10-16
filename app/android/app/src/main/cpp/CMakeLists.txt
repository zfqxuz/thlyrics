cmake_minimum_required(VERSION 3.22)
project(thlyrics_openjtalk C CXX)

set(CMAKE_C_STANDARD 99)
set(CMAKE_CXX_STANDARD 14)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
add_compile_options(-O2 -fPIC -w)

file(GLOB MECAB_SOURCES CONFIGURE_DEPENDS vendor/mecab/*.cpp)
list(REMOVE_ITEM MECAB_SOURCES ${CMAKE_CURRENT_SOURCE_DIR}/vendor/mecab/mecab-dict-index.cpp)

file(GLOB HTS_SOURCES CONFIGURE_DEPENDS vendor/hts_engine/lib/*.c)
file(GLOB OJ_SOURCES CONFIGURE_DEPENDS vendor/open_jtalk/*/*.c)

add_library(openjtalk SHARED
  ${MECAB_SOURCES}
  ${HTS_SOURCES}
  ${OJ_SOURCES}
  openjtalk_jni.c
)

target_compile_definitions(openjtalk PRIVATE
  HAVE_CONFIG_H=1
  DIC_VERSION=102
  MECAB_USE_UTF8_ONLY=1
  CHARSET_UTF_8=1
  AUDIO_PLAY_NONE=1
)

target_include_directories(openjtalk PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/vendor/mecab
  ${CMAKE_CURRENT_SOURCE_DIR}/vendor/hts_engine/include
  ${CMAKE_CURRENT_SOURCE_DIR}/vendor/open_jtalk/jpcommon
  ${CMAKE_CURRENT_SOURCE_DIR}/vendor/open_jtalk/mecab2njd
  ${CMAKE_CURRENT_SOURCE_DIR}/vendor/open_jtalk/njd
  ${CMAKE_CURRENT_SOURCE_DIR}/vendor/open_jtalk/njd2jpcommon
  ${CMAKE_CURRENT_SOURCE_DIR}/vendor/open_jtalk/njd_set_accent_phrase
  ${CMAKE_CURRENT_SOURCE_DIR}/vendor/open_jtalk/njd_set_accent_type
  ${CMAKE_CURRENT_SOURCE_DIR}/vendor/open_jtalk/njd_set_digit
  ${CMAKE_CURRENT_SOURCE_DIR}/vendor/open_jtalk/njd_set_long_vowel
  ${CMAKE_CURRENT_SOURCE_DIR}/vendor/open_jtalk/njd_set_pronunciation
  ${CMAKE_CURRENT_SOURCE_DIR}/vendor/open_jtalk/njd_set_unvoiced_vowel
  ${CMAKE_CURRENT_SOURCE_DIR}/vendor/open_jtalk/text2mecab
)

target_link_libraries(openjtalk log m)
